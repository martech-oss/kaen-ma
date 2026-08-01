import type { KaenmaDatabase } from "@kaenma/database";
import type { DealSummary, DealTask } from "@kaenma/orpc";

export interface PipelineRow {
  id: string;
  name: string;
  is_default: number;
}

export interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
  probability: number;
}

export interface DealRow extends Record<string, unknown> {
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

export interface TaskRow extends Record<string, unknown> {
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

export function serializeDeal(row: DealRow): DealSummary {
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

export function serializeTask(row: TaskRow): DealTask {
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
