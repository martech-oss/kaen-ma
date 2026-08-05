import { DealRepository, writeAuditLog, type OpenEngageDatabase } from "@openengage/database";
import type {
  DealCreate,
  DealDetailData,
  DealListData,
  DealOptions,
  DealSummary,
  DealTask,
  DealTaskCreate,
  DealTaskUpdate,
  DealUpdate,
  WorkspaceContext,
} from "@openengage/orpc";

import { serializeDeal, serializeStage, serializeTask } from "./records";

/** Deals list needs a pipeline; a missing one is distinct from an empty list. */
export type DealListOutcome = { kind: "pipeline_not_found" } | { kind: "ok"; data: DealListData };
export type DealWriteOutcome =
  | { kind: "invalid_reference"; message: string }
  | { kind: "not_found" }
  | { kind: "ok"; deal: DealSummary };
export type DealMoveOutcome =
  | { kind: "not_found" }
  | { kind: "invalid_stage" }
  | { kind: "ok"; deal: DealSummary };
export type DealTaskOutcome =
  | { kind: "not_found" }
  | { kind: "invalid_assignee" }
  | { kind: "ok"; task: DealTask };

interface Background {
  waitUntil(promise: Promise<unknown>): void;
}

export async function getDealOptions(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<DealOptions> {
  const repository = new DealRepository(database, workspace);
  await repository.ensureDefaultPipeline();
  const rows = await repository.getDealOptionRows();

  const stagesByPipeline = new Map<string, typeof rows.stages>();
  for (const stage of rows.stages) {
    const stages = stagesByPipeline.get(stage.pipelineId) ?? [];
    stages.push(stage);
    stagesByPipeline.set(stage.pipelineId, stages);
  }

  return {
    pipelines: rows.pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: Boolean(pipeline.isDefault),
      stages: (stagesByPipeline.get(pipeline.id) ?? []).map(serializeStage),
    })),
    contacts: rows.contacts,
    companies: rows.companies,
    members: rows.members,
  };
}

export async function listDeals(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: {
    pipelineId?: string | undefined;
    status: "open" | "won" | "lost" | "all";
    q?: string | undefined;
  },
): Promise<DealListOutcome> {
  const repository = new DealRepository(database, workspace);
  const defaultPipelineId = await repository.ensureDefaultPipeline();
  const pipelineId = input.pipelineId ?? defaultPipelineId;
  if (!(await repository.pipelineExists(pipelineId))) {
    return { kind: "pipeline_not_found" };
  }

  const { items, summary } = await repository.listDeals({
    pipelineId,
    status: input.status,
    q: input.q,
  });

  return {
    kind: "ok",
    data: {
      items: items.map(serializeDeal),
      summary: {
        openCount: Number(summary?.open_count ?? 0),
        openValue: Number(summary?.open_value ?? 0),
        wonCount: Number(summary?.won_count ?? 0),
        wonValue: Number(summary?.won_value ?? 0),
        lostCount: Number(summary?.lost_count ?? 0),
      },
    },
  };
}

export async function getDealDetail(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<DealDetailData | null> {
  const repository = new DealRepository(database, workspace);
  const deal = await repository.getDeal(id);
  if (!deal) return null;
  const tasks = await repository.listDealTasks(deal.id);
  return { deal: serializeDeal(deal), tasks: tasks.map(serializeTask) };
}

export async function createDeal(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: DealCreate,
  background: Background,
): Promise<DealWriteOutcome> {
  const repository = new DealRepository(database, workspace);
  const referenceError = await repository.validateDealReferences(input);
  if (referenceError) return { kind: "invalid_reference", message: referenceError };

  const deal = await repository.createDeal(input);
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.create",
      resourceType: "deal",
      resourceId: deal.id,
    }),
  );
  return { kind: "ok", deal: serializeDeal(deal) };
}

/** Patch semantics: unset fields keep the stored value, so the merge happens here. */
export async function updateDeal(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: DealUpdate,
  background: Background,
): Promise<DealWriteOutcome> {
  const repository = new DealRepository(database, workspace);
  const current = await repository.getDeal(id);
  if (!current) return { kind: "not_found" };

  const merged: DealCreate = {
    name: input.name ?? current.name,
    pipelineId: input.pipelineId ?? current.pipeline_id,
    stageId: input.stageId ?? current.stage_id,
    value: input.value ?? Number(current.value),
    currency: input.currency ?? current.currency,
    status: input.status ?? current.status,
    ownerUserId: input.ownerUserId === undefined ? current.owner_user_id : input.ownerUserId,
    contactId: input.contactId === undefined ? current.contact_id : input.contactId,
    companyId: input.companyId === undefined ? current.company_id : input.companyId,
    expectedCloseDate:
      input.expectedCloseDate === undefined ? current.expected_close_date : input.expectedCloseDate,
    description: input.description ?? current.description,
  };
  const referenceError = await repository.validateDealReferences(merged);
  if (referenceError) return { kind: "invalid_reference", message: referenceError };

  const now = new Date().toISOString();
  const wonAt = merged.status === "won" ? (current.status === "won" ? current.won_at : now) : null;
  const lostAt =
    merged.status === "lost" ? (current.status === "lost" ? current.lost_at : now) : null;
  await repository.updateDeal(current.id, { ...merged, wonAt, lostAt, updatedAt: now });
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: current.status === merged.status ? "deal.update" : "deal.status_change",
      resourceType: "deal",
      resourceId: current.id,
      ...(current.status === merged.status
        ? {}
        : { metadata: { previousStatus: current.status, status: merged.status } }),
    }),
  );
  const deal = await repository.getDeal(current.id);
  return { kind: "ok", deal: serializeDeal(deal!) };
}

export async function moveDeal(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  stageId: string,
  background: Background,
): Promise<DealMoveOutcome> {
  const repository = new DealRepository(database, workspace);
  const deal = await repository.getDeal(id);
  if (!deal) return { kind: "not_found" };
  if (!(await repository.stageExistsInPipeline(deal.pipeline_id, stageId))) {
    return { kind: "invalid_stage" };
  }
  const updated = await repository.moveDeal(deal.id, stageId);
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.move",
      resourceType: "deal",
      resourceId: deal.id,
      metadata: { previousStageId: deal.stage_id, stageId },
    }),
  );
  return { kind: "ok", deal: serializeDeal(updated!) };
}

export async function archiveDeal(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  background: Background,
): Promise<boolean> {
  const repository = new DealRepository(database, workspace);
  if (!(await repository.archiveDeal(id))) return false;
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.archive",
      resourceType: "deal",
      resourceId: id,
    }),
  );
  return true;
}

export async function createDealTask(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  input: DealTaskCreate,
): Promise<DealTaskOutcome> {
  const repository = new DealRepository(database, workspace);
  if (!(await repository.dealExists(dealId))) return { kind: "not_found" };
  if (input.assignedUserId && !(await repository.memberExists(input.assignedUserId))) {
    return { kind: "invalid_assignee" };
  }
  const task = await repository.createDealTask(dealId, input);
  return { kind: "ok", task: serializeTask(task) };
}

export async function updateDealTask(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  taskId: string,
  input: DealTaskUpdate,
): Promise<DealTaskOutcome> {
  const repository = new DealRepository(database, workspace);
  const current = await repository.getTask(dealId, taskId);
  if (!current) return { kind: "not_found" };
  const assignedUserId =
    input.assignedUserId === undefined ? current.assigned_user_id : input.assignedUserId;
  if (assignedUserId && !(await repository.memberExists(assignedUserId))) {
    return { kind: "invalid_assignee" };
  }
  const status = input.status ?? current.status;
  const now = new Date().toISOString();
  // Keep the original completion time when a task was already completed.
  const completedAt =
    status === "completed" ? (current.status === "completed" ? current.completed_at : now) : null;
  const task = await repository.updateDealTask(dealId, taskId, {
    type: input.type ?? current.type,
    title: input.title ?? current.title,
    notes: input.notes ?? current.notes,
    dueAt: input.dueAt === undefined ? current.due_at : input.dueAt,
    status,
    assignedUserId,
    completedAt,
    updatedAt: now,
  });
  return { kind: "ok", task: serializeTask(task!) };
}

export async function deleteDealTask(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  taskId: string,
): Promise<boolean> {
  const repository = new DealRepository(database, workspace);
  return repository.deleteDealTask(dealId, taskId);
}
