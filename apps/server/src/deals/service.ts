import { uuidv7, writeAuditLog, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/orpc";
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
} from "@kaenma/orpc";

import { primitiveString } from "../platform/values";
import {
  dealSelectSql,
  getDeal,
  getTask,
  serializeDeal,
  serializeStage,
  serializeTask,
  type DealRow,
  type PipelineRow,
  type StageRow,
  type TaskRow,
} from "./records";
import {
  dealExists,
  ensureDefaultPipeline,
  memberExists,
  pipelineExists,
  validateDealReferences,
} from "./repository";

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

export async function getDealOptions(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<DealOptions> {
  const workspaceId = workspace.workspaceId;
  await ensureDefaultPipeline(database, workspaceId);
  const results = await database.batch([
    database
      .prepare(
        `SELECT id, name, is_default
           FROM deal_pipelines
           WHERE workspace_id = ? AND archived_at IS NULL
           ORDER BY is_default DESC, name ASC`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT id, pipeline_id, name, color, position, probability
           FROM deal_stages
           WHERE workspace_id = ?
           ORDER BY pipeline_id, position`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT id, email, first_name, last_name
           FROM contacts
           WHERE workspace_id = ? AND status != 'archived'
           ORDER BY COALESCE(last_name, first_name, email, id) ASC
           LIMIT 500`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT id, name, domain
           FROM companies
           WHERE workspace_id = ?
           ORDER BY name ASC
           LIMIT 500`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT u.id, u.name, u.email
           FROM member m
           JOIN user u ON u.id = m.user_id
           WHERE m.organization_id = ?
           ORDER BY u.name ASC, u.email ASC`,
      )
      .bind(workspaceId),
  ] as const);

  const stagesByPipeline = new Map<string, StageRow[]>();
  for (const stage of (results[1]?.results ?? []) as StageRow[]) {
    const stages = stagesByPipeline.get(stage.pipeline_id) ?? [];
    stages.push(stage);
    stagesByPipeline.set(stage.pipeline_id, stages);
  }
  const contacts = (results[2]?.results ?? []) as Array<Record<string, unknown>>;
  const accounts = (results[3]?.results ?? []) as Array<Record<string, unknown>>;
  const members = (results[4]?.results ?? []) as Array<Record<string, unknown>>;
  const str = (value: unknown): string => primitiveString(value);
  const nullable = (value: unknown): string | null =>
    value === null || value === undefined ? null : primitiveString(value);

  return {
    pipelines: ((results[0]?.results ?? []) as PipelineRow[]).map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: Boolean(pipeline.is_default),
      stages: (stagesByPipeline.get(pipeline.id) ?? []).map(serializeStage),
    })),
    contacts: contacts.map((row) => ({
      id: str(row["id"]),
      email: nullable(row["email"]),
      firstName: nullable(row["first_name"]),
      lastName: nullable(row["last_name"]),
    })),
    accounts: accounts.map((row) => ({
      id: str(row["id"]),
      name: str(row["name"]),
      domain: nullable(row["domain"]),
    })),
    members: members.map((row) => ({
      id: str(row["id"]),
      name: str(row["name"]),
      email: str(row["email"]),
    })),
  };
}

export async function listDeals(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: {
    pipelineId?: string | undefined;
    status: "open" | "won" | "lost" | "all";
    q?: string | undefined;
  },
): Promise<DealListOutcome> {
  const workspaceId = workspace.workspaceId;
  const defaultPipelineId = await ensureDefaultPipeline(database, workspaceId);
  const pipelineId = input.pipelineId ?? defaultPipelineId;
  if (!(await pipelineExists(database, workspaceId, pipelineId))) {
    return { kind: "pipeline_not_found" };
  }

  const conditions = ["d.workspace_id = ?", "d.pipeline_id = ?", "d.archived_at IS NULL"];
  const bindings: unknown[] = [workspaceId, pipelineId];
  if (input.status !== "all") {
    conditions.push("d.status = ?");
    bindings.push(input.status);
  }
  if (input.q) {
    conditions.push(
      `(d.name LIKE ? OR c.email LIKE ? OR c.first_name LIKE ?
        OR c.last_name LIKE ? OR co.name LIKE ?)`,
    );
    const query = `%${input.q}%`;
    bindings.push(query, query, query, query, query);
  }

  const [dealResult, summary] = await Promise.all([
    database
      .prepare(`${dealSelectSql} WHERE ${conditions.join(" AND ")}
        ORDER BY ds.position ASC, d.updated_at DESC`)
      .bind(...bindings)
      .all<DealRow>(),
    database
      .prepare(
        `SELECT
           COUNT(CASE WHEN status = 'open' THEN 1 END) AS open_count,
           COALESCE(SUM(CASE WHEN status = 'open' THEN value ELSE 0 END), 0) AS open_value,
           COUNT(CASE WHEN status = 'won' THEN 1 END) AS won_count,
           COALESCE(SUM(CASE WHEN status = 'won' THEN value ELSE 0 END), 0) AS won_value,
           COUNT(CASE WHEN status = 'lost' THEN 1 END) AS lost_count
         FROM deals
         WHERE workspace_id = ? AND pipeline_id = ? AND archived_at IS NULL`,
      )
      .bind(workspaceId, pipelineId)
      .first<{
        open_count: number;
        open_value: number;
        won_count: number;
        won_value: number;
        lost_count: number;
      }>(),
  ]);

  return {
    kind: "ok",
    data: {
      items: dealResult.results.map(serializeDeal),
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
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<DealDetailData | null> {
  const workspaceId = workspace.workspaceId;
  const deal = await getDeal(database, workspaceId, id);
  if (!deal) return null;
  const tasks = await database
    .prepare(
      `SELECT dt.*, u.name AS assignee_name, u.email AS assignee_email
       FROM deal_tasks dt
       LEFT JOIN user u ON u.id = dt.assigned_user_id
       WHERE dt.workspace_id = ? AND dt.deal_id = ?
       ORDER BY
         CASE WHEN dt.status = 'open' THEN 0 ELSE 1 END,
         CASE WHEN dt.due_at IS NULL THEN 1 ELSE 0 END,
         dt.due_at ASC,
         dt.created_at DESC`,
    )
    .bind(workspaceId, deal.id)
    .all<TaskRow>();
  return { deal: serializeDeal(deal), tasks: tasks.results.map(serializeTask) };
}

interface Background {
  waitUntil(promise: Promise<unknown>): void;
}

export async function createDeal(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: DealCreate,
  background: Background,
): Promise<DealWriteOutcome> {
  const referenceError = await validateDealReferences(database, workspace.workspaceId, input);
  if (referenceError) return { kind: "invalid_reference", message: referenceError };

  const id = uuidv7();
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO deals (
         id, workspace_id, pipeline_id, stage_id, name, value, currency, status,
         owner_user_id, contact_id, account_id, expected_close_date, description,
         won_at, lost_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      workspace.workspaceId,
      input.pipelineId,
      input.stageId,
      input.name,
      input.value,
      input.currency,
      input.status,
      input.ownerUserId ?? null,
      input.contactId ?? null,
      input.accountId ?? null,
      input.expectedCloseDate ?? null,
      input.description,
      input.status === "won" ? now : null,
      input.status === "lost" ? now : null,
      now,
      now,
    )
    .run();
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.create",
      resourceType: "deal",
      resourceId: id,
    }),
  );
  const deal = await getDeal(database, workspace.workspaceId, id);
  return { kind: "ok", deal: serializeDeal(deal!) };
}

/** Patch semantics: unset fields keep the stored value, so the merge happens here. */
export async function updateDeal(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: DealUpdate,
  background: Background,
): Promise<DealWriteOutcome> {
  const current = await getDeal(database, workspace.workspaceId, id);
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
    accountId: input.accountId === undefined ? current.account_id : input.accountId,
    expectedCloseDate:
      input.expectedCloseDate === undefined ? current.expected_close_date : input.expectedCloseDate,
    description: input.description ?? current.description,
  };
  const referenceError = await validateDealReferences(database, workspace.workspaceId, merged);
  if (referenceError) return { kind: "invalid_reference", message: referenceError };

  const now = new Date().toISOString();
  const wonAt = merged.status === "won" ? (current.status === "won" ? current.won_at : now) : null;
  const lostAt =
    merged.status === "lost" ? (current.status === "lost" ? current.lost_at : now) : null;
  await database
    .prepare(
      `UPDATE deals SET
         pipeline_id = ?, stage_id = ?, name = ?, value = ?, currency = ?, status = ?,
         owner_user_id = ?, contact_id = ?, account_id = ?, expected_close_date = ?,
         description = ?, won_at = ?, lost_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
    )
    .bind(
      merged.pipelineId,
      merged.stageId,
      merged.name,
      merged.value,
      merged.currency,
      merged.status,
      merged.ownerUserId ?? null,
      merged.contactId ?? null,
      merged.accountId ?? null,
      merged.expectedCloseDate ?? null,
      merged.description,
      wonAt,
      lostAt,
      now,
      workspace.workspaceId,
      current.id,
    )
    .run();
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
  const deal = await getDeal(database, workspace.workspaceId, current.id);
  return { kind: "ok", deal: serializeDeal(deal!) };
}

export async function moveDeal(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  stageId: string,
  background: Background,
): Promise<DealMoveOutcome> {
  const workspaceId = workspace.workspaceId;
  const deal = await getDeal(database, workspaceId, id);
  if (!deal) return { kind: "not_found" };
  const stage = await database
    .prepare(
      `SELECT id FROM deal_stages
       WHERE workspace_id = ? AND pipeline_id = ? AND id = ?`,
    )
    .bind(workspaceId, deal.pipeline_id, stageId)
    .first();
  if (!stage) return { kind: "invalid_stage" };
  await database
    .prepare(
      `UPDATE deals SET stage_id = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
    )
    .bind(stageId, new Date().toISOString(), workspaceId, deal.id)
    .run();
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.move",
      resourceType: "deal",
      resourceId: deal.id,
      metadata: { previousStageId: deal.stage_id, stageId },
    }),
  );
  const updated = await getDeal(database, workspaceId, deal.id);
  return { kind: "ok", deal: serializeDeal(updated!) };
}

export async function archiveDeal(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  background: Background,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE deals SET archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
    )
    .bind(now, now, workspace.workspaceId, id)
    .run();
  if (result.meta.changes === 0) return false;
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
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  input: DealTaskCreate,
): Promise<DealTaskOutcome> {
  const workspaceId = workspace.workspaceId;
  if (!(await dealExists(database, workspaceId, dealId))) return { kind: "not_found" };
  if (input.assignedUserId && !(await memberExists(database, workspaceId, input.assignedUserId))) {
    return { kind: "invalid_assignee" };
  }
  const id = uuidv7();
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO deal_tasks (
         id, workspace_id, deal_id, type, title, notes, due_at, status,
         assigned_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .bind(
      id,
      workspaceId,
      dealId,
      input.type,
      input.title,
      input.notes,
      input.dueAt ?? null,
      input.assignedUserId ?? null,
      now,
      now,
    )
    .run();
  const task = await getTask(database, workspaceId, dealId, id);
  return { kind: "ok", task: serializeTask(task!) };
}

export async function updateDealTask(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  taskId: string,
  input: DealTaskUpdate,
): Promise<DealTaskOutcome> {
  const workspaceId = workspace.workspaceId;
  const current = await getTask(database, workspaceId, dealId, taskId);
  if (!current) return { kind: "not_found" };
  const assignedUserId =
    input.assignedUserId === undefined ? current.assigned_user_id : input.assignedUserId;
  if (assignedUserId && !(await memberExists(database, workspaceId, assignedUserId))) {
    return { kind: "invalid_assignee" };
  }
  const status = input.status ?? current.status;
  const now = new Date().toISOString();
  // Keep the original completion time when a task was already completed.
  const completedAt =
    status === "completed" ? (current.status === "completed" ? current.completed_at : now) : null;
  await database
    .prepare(
      `UPDATE deal_tasks SET
         type = ?, title = ?, notes = ?, due_at = ?, status = ?,
         assigned_user_id = ?, completed_at = ?, updated_at = ?
       WHERE workspace_id = ? AND deal_id = ? AND id = ?`,
    )
    .bind(
      input.type ?? current.type,
      input.title ?? current.title,
      input.notes ?? current.notes,
      input.dueAt === undefined ? current.due_at : input.dueAt,
      status,
      assignedUserId,
      completedAt,
      now,
      workspaceId,
      dealId,
      taskId,
    )
    .run();
  const task = await getTask(database, workspaceId, dealId, taskId);
  return { kind: "ok", task: serializeTask(task!) };
}

export async function deleteDealTask(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  taskId: string,
): Promise<boolean> {
  const result = await database
    .prepare(
      `DELETE FROM deal_tasks
       WHERE workspace_id = ? AND deal_id = ? AND id = ?`,
    )
    .bind(workspace.workspaceId, dealId, taskId)
    .run();
  return result.meta.changes > 0;
}
