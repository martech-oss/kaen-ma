import {
  uuidv7,
  writeAuditLog,
  type DrizzleRawStatement,
  type KaenmaDatabase,
} from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/shared";
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
} from "@kaenma/shared/deals";

import { primitiveString } from "../values";

const defaultStages = [
  { name: "新規", color: "#64748b", probability: 10 },
  { name: "連絡済み", color: "#3b82f6", probability: 25 },
  { name: "提案", color: "#8b5cf6", probability: 50 },
  { name: "交渉", color: "#f59e0b", probability: 75 },
  { name: "最終確認", color: "#10b981", probability: 90 },
] as const;

interface PipelineRow {
  id: string;
  name: string;
  is_default: number;
}

interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
  probability: number;
}

interface DealRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  pipeline_id: string;
  pipeline_name: string;
  stage_id: string;
  stage_name: string;
  stage_color: string;
  stage_position: number;
  stage_probability: number;
  name: string;
  value: number;
  currency: string;
  status: "open" | "won" | "lost";
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  contact_id: string | null;
  contact_email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  account_id: string | null;
  account_name: string | null;
  expected_close_date: string | null;
  description: string;
  won_at: string | null;
  lost_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  open_task_count: number;
  next_task_at: string | null;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  deal_id: string;
  type: "task" | "call" | "email" | "meeting";
  title: string;
  notes: string;
  due_at: string | null;
  status: "open" | "completed";
  assigned_user_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const dealSelectSql = `
  SELECT
    d.*,
    dp.name AS pipeline_name,
    ds.name AS stage_name,
    ds.color AS stage_color,
    ds.position AS stage_position,
    ds.probability AS stage_probability,
    u.name AS owner_name,
    u.email AS owner_email,
    c.email AS contact_email,
    c.first_name AS contact_first_name,
    c.last_name AS contact_last_name,
    co.name AS account_name,
    (
      SELECT COUNT(*)
      FROM deal_tasks dt
      WHERE dt.workspace_id = d.workspace_id
        AND dt.deal_id = d.id
        AND dt.status = 'open'
    ) AS open_task_count,
    (
      SELECT MIN(dt.due_at)
      FROM deal_tasks dt
      WHERE dt.workspace_id = d.workspace_id
        AND dt.deal_id = d.id
        AND dt.status = 'open'
    ) AS next_task_at
  FROM deals d
  JOIN deal_pipelines dp
    ON dp.workspace_id = d.workspace_id AND dp.id = d.pipeline_id
  JOIN deal_stages ds
    ON ds.workspace_id = d.workspace_id AND ds.id = d.stage_id
  LEFT JOIN user u ON u.id = d.owner_user_id
  LEFT JOIN contacts c
    ON c.workspace_id = d.workspace_id AND c.id = d.contact_id
  LEFT JOIN companies co
    ON co.workspace_id = d.workspace_id AND co.id = d.account_id`;

export async function ensureDefaultPipeline(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<string> {
  const existing = await database
    .prepare(
      `SELECT id FROM deal_pipelines
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const pipelineId = uuidv7();
  const now = new Date().toISOString();
  const statements: DrizzleRawStatement[] = [
    database
      .prepare(
        `INSERT INTO deal_pipelines
         (id, workspace_id, name, is_default, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(pipelineId, workspaceId, "セールスパイプライン", now, now),
    ...defaultStages.map((stage, position) =>
      database
        .prepare(
          `INSERT INTO deal_stages
           (id, workspace_id, pipeline_id, name, color, position, probability, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          uuidv7(),
          workspaceId,
          pipelineId,
          stage.name,
          stage.color,
          position,
          stage.probability,
          now,
          now,
        ),
    ),
  ];
  try {
    await database.batch(statements);
    return pipelineId;
  } catch {
    const raced = await database
      .prepare(
        `SELECT id FROM deal_pipelines
         WHERE workspace_id = ? AND archived_at IS NULL
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
      )
      .bind(workspaceId)
      .first<{ id: string }>();
    if (raced) return raced.id;
    throw new Error("デフォルトの商談パイプラインを作成できませんでした");
  }
}

export async function validateDealReferences(
  database: KaenmaDatabase,
  workspaceId: string,
  input: DealCreate,
): Promise<string | null> {
  const stage = await database
    .prepare(
      `SELECT ds.id
       FROM deal_stages ds
       JOIN deal_pipelines dp
         ON dp.workspace_id = ds.workspace_id AND dp.id = ds.pipeline_id
       WHERE ds.workspace_id = ? AND ds.pipeline_id = ? AND ds.id = ?
         AND dp.archived_at IS NULL`,
    )
    .bind(workspaceId, input.pipelineId, input.stageId)
    .first();
  if (!stage) return "パイプラインまたはステージが見つかりません";
  if (
    input.contactId &&
    !(await database
      .prepare(
        `SELECT id FROM contacts
         WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(workspaceId, input.contactId)
      .first())
  ) {
    return "連絡先が見つかりません";
  }
  if (
    input.accountId &&
    !(await database
      .prepare("SELECT id FROM companies WHERE workspace_id = ? AND id = ?")
      .bind(workspaceId, input.accountId)
      .first())
  ) {
    return "アカウントが見つかりません";
  }
  if (input.ownerUserId && !(await memberExists(database, workspaceId, input.ownerUserId))) {
    return "担当者が見つかりません";
  }
  return null;
}

export async function pipelineExists(
  database: KaenmaDatabase,
  workspaceId: string,
  pipelineId: string,
): Promise<boolean> {
  return Boolean(
    await database
      .prepare(
        `SELECT id FROM deal_pipelines
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(workspaceId, pipelineId)
      .first(),
  );
}

export async function dealExists(
  database: KaenmaDatabase,
  workspaceId: string,
  dealId: string,
): Promise<boolean> {
  return Boolean(
    await database
      .prepare(
        `SELECT id FROM deals
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(workspaceId, dealId)
      .first(),
  );
}

export async function memberExists(
  database: KaenmaDatabase,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  return Boolean(
    await database
      .prepare("SELECT id FROM member WHERE organization_id = ? AND user_id = ?")
      .bind(workspaceId, userId)
      .first(),
  );
}

export async function getDeal(
  database: KaenmaDatabase,
  workspaceId: string,
  id: string,
): Promise<DealRow | null> {
  return database
    .prepare(`${dealSelectSql} WHERE d.workspace_id = ? AND d.id = ? AND d.archived_at IS NULL`)
    .bind(workspaceId, id)
    .first<DealRow>();
}

export async function getTask(
  database: KaenmaDatabase,
  workspaceId: string,
  dealId: string,
  taskId: string,
): Promise<TaskRow | null> {
  return database
    .prepare(
      `SELECT dt.*, u.name AS assignee_name, u.email AS assignee_email
       FROM deal_tasks dt
       LEFT JOIN user u ON u.id = dt.assigned_user_id
       WHERE dt.workspace_id = ? AND dt.deal_id = ? AND dt.id = ?`,
    )
    .bind(workspaceId, dealId, taskId)
    .first<TaskRow>();
}

export function serializeStage(stage: StageRow) {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    position: Number(stage.position),
    probability: Number(stage.probability),
  };
}

export function serializeDeal(row: DealRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipeline_name,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageColor: row.stage_color,
    stagePosition: Number(row.stage_position),
    stageProbability: Number(row.stage_probability),
    name: row.name,
    value: Number(row.value),
    currency: row.currency,
    status: row.status,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    contactId: row.contact_id,
    contactEmail: row.contact_email,
    contactFirstName: row.contact_first_name,
    contactLastName: row.contact_last_name,
    accountId: row.account_id,
    accountName: row.account_name,
    expectedCloseDate: row.expected_close_date,
    description: row.description,
    wonAt: row.won_at,
    lostAt: row.lost_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openTaskCount: Number(row.open_task_count),
    nextTaskAt: row.next_task_at,
  };
}

export function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    dealId: row.deal_id,
    type: row.type,
    title: row.title,
    notes: row.notes,
    dueAt: row.due_at,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    assigneeName: row.assignee_name,
    assigneeEmail: row.assignee_email,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
