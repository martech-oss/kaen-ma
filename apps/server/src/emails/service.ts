import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/shared";
import type {
  BroadcastSegmentOption,
  BroadcastStatus,
  BroadcastWrite,
  EmailCampaign,
  MessageVariable,
  MessageVariableWrite,
  SubscriptionTopicOption,
} from "@kaenma/shared/emails";

import { hasValidBroadcastResources } from "../broadcasts/routes";
import type { RuntimeEnv } from "../env";
import { nullablePrimitiveString, numericValue, primitiveString } from "../values";

export * from "./template-service";

const broadcastRowSelect = `SELECT b.id, b.name, b.segment_id, b.template_id, b.topic_id,
              b.status, b.scheduled_at, b.started_at, b.completed_at,
              b.archived_at, b.created_at, b.updated_at,
              s.name AS segment_name, s.member_count,
              et.name AS template_name, et.subject,
              (SELECT COUNT(*) FROM broadcast_recipients br
               WHERE br.workspace_id = b.workspace_id AND br.broadcast_id = b.id)
                AS recipient_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status IN ('accepted', 'delivered')) AS sent_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status = 'delivered') AS delivered_count
       FROM broadcasts b
       JOIN segments s ON s.workspace_id = b.workspace_id AND s.id = b.segment_id
       JOIN email_templates et
         ON et.workspace_id = b.workspace_id AND et.id = b.template_id`;

function toEmailCampaign(row: Record<string, unknown>): EmailCampaign {
  return {
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    segmentId: primitiveString(row["segment_id"]),
    templateId: primitiveString(row["template_id"]),
    topicId: nullablePrimitiveString(row["topic_id"]),
    status: primitiveString(row["status"]) as BroadcastStatus,
    scheduledAt: nullablePrimitiveString(row["scheduled_at"]),
    startedAt: nullablePrimitiveString(row["started_at"]),
    completedAt: nullablePrimitiveString(row["completed_at"]),
    archivedAt: nullablePrimitiveString(row["archived_at"]),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
    segmentName: primitiveString(row["segment_name"]),
    memberCount: numericValue(row["member_count"]),
    templateName: primitiveString(row["template_name"]),
    subject: nullablePrimitiveString(row["subject"]),
    recipientCount: numericValue(row["recipient_count"]),
    sentCount: numericValue(row["sent_count"]),
    deliveredCount: numericValue(row["delivered_count"]),
  };
}

export async function listEmailCampaigns(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<EmailCampaign[]> {
  const result = await database
    .prepare(
      `${broadcastRowSelect}
       WHERE b.workspace_id = ?
         AND ${archived ? "b.archived_at IS NOT NULL" : "b.archived_at IS NULL"}
       ORDER BY b.updated_at DESC LIMIT 200`,
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map(toEmailCampaign);
}

export async function getEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  broadcastId: string,
): Promise<EmailCampaign | null> {
  const row = await database
    .prepare(`${broadcastRowSelect} WHERE b.workspace_id = ? AND b.id = ?`)
    .bind(workspace.workspaceId, broadcastId)
    .first<Record<string, unknown>>();
  return row ? toEmailCampaign(row) : null;
}

/** Create can only fail on resources; update can also find nothing editable. */
export type BroadcastCreateOutcome =
  | { kind: "invalid_resources" }
  | { kind: "created"; id: string };
export type BroadcastUpdateOutcome =
  | { kind: "invalid_resources" }
  | { kind: "not_editable" }
  | { kind: "updated" };

export async function createEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: BroadcastWrite,
): Promise<BroadcastCreateOutcome> {
  const workspaceId = workspace.workspaceId;
  if (
    !(await hasValidBroadcastResources(database, workspaceId, input.segmentId, input.templateId))
  ) {
    return { kind: "invalid_resources" };
  }
  const id = uuidv7();
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO broadcasts
       (id, workspace_id, name, segment_id, template_id, topic_id,
        status, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      workspaceId,
      input.name,
      input.segmentId,
      input.templateId,
      input.topicId ?? null,
      input.scheduledAt ? "scheduled" : "draft",
      input.scheduledAt ?? null,
      now,
      now,
    )
    .run();
  return { kind: "created", id };
}

export async function updateEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: BroadcastWrite,
): Promise<BroadcastUpdateOutcome> {
  const workspaceId = workspace.workspaceId;
  if (
    !(await hasValidBroadcastResources(database, workspaceId, input.segmentId, input.templateId))
  ) {
    return { kind: "invalid_resources" };
  }
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE broadcasts
       SET name = ?, segment_id = ?, template_id = ?, topic_id = ?,
           status = ?, scheduled_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL
         AND status IN ('draft', 'scheduled')`,
    )
    .bind(
      input.name,
      input.segmentId,
      input.templateId,
      input.topicId ?? null,
      input.scheduledAt ? "scheduled" : "draft",
      input.scheduledAt ?? null,
      now,
      workspaceId,
      id,
    )
    .run();
  return result.meta.changes === 1 ? { kind: "updated" } : { kind: "not_editable" };
}

/** Flips the broadcast to sending and enqueues the first batch. */
export async function startEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  id: string,
): Promise<"ok" | "not_configured" | "not_startable"> {
  if (!env.RESEND_SEND_API_KEY) return "not_configured";
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE broadcasts SET status = 'sending', started_at = COALESCE(started_at, ?),
       updated_at = ? WHERE workspace_id = ? AND id = ?
       AND archived_at IS NULL AND status IN ('draft', 'scheduled')`,
    )
    .bind(now, now, workspace.workspaceId, id)
    .run();
  if (result.meta.changes !== 1) return "not_startable";
  await env.CAMPAIGN_QUEUE.send({ kind: "broadcast_batch", broadcastId: id });
  return "ok";
}

export async function archiveEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE broadcasts
       SET status = CASE WHEN status IN ('draft', 'scheduled') THEN 'cancelled' ELSE status END,
           archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL
         AND status <> 'sending'`,
    )
    .bind(now, now, workspace.workspaceId, id)
    .run();
  return result.meta.changes === 1;
}

export async function listMessageVariables(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<MessageVariable[]> {
  const result = await database
    .prepare(
      `SELECT id, key, name, value, description, archived_at, created_at, updated_at
       FROM message_variables
       WHERE workspace_id = ?
         AND archived_at IS ${archived ? "NOT NULL" : "NULL"}
       ORDER BY updated_at DESC`,
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: primitiveString(row["id"]),
    key: primitiveString(row["key"]),
    name: primitiveString(row["name"]),
    value: primitiveString(row["value"]),
    description: primitiveString(row["description"]),
    archivedAt: nullablePrimitiveString(row["archived_at"]),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
  }));
}

export class VariableConflictError extends Error {
  public override readonly name = "VariableConflictError";
}

export async function createMessageVariable(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: MessageVariableWrite,
): Promise<{ id: string }> {
  const id = uuidv7();
  const now = new Date().toISOString();
  try {
    await database
      .prepare(
        `INSERT INTO message_variables
         (id, workspace_id, key, name, value, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        workspace.workspaceId,
        input.key,
        input.name,
        input.value,
        input.description,
        now,
        now,
      )
      .run();
  } catch {
    throw new VariableConflictError();
  }
  return { id };
}

export async function updateMessageVariable(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: MessageVariableWrite,
): Promise<boolean> {
  try {
    const result = await database
      .prepare(
        `UPDATE message_variables
         SET key = ?, name = ?, value = ?, description = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(
        input.key,
        input.name,
        input.value,
        input.description,
        new Date().toISOString(),
        workspace.workspaceId,
        id,
      )
      .run();
    return result.meta.changes === 1;
  } catch {
    throw new VariableConflictError();
  }
}

export async function archiveMessageVariable(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE message_variables SET archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
    )
    .bind(now, now, workspace.workspaceId, id)
    .run();
  return result.meta.changes === 1;
}

export async function listBroadcastSegmentOptions(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<BroadcastSegmentOption[]> {
  const result = await database
    .prepare(
      `SELECT id, name, member_count FROM segments
       WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`,
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    memberCount: numericValue(row["member_count"]),
  }));
}

export async function listSubscriptionTopicOptions(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<SubscriptionTopicOption[]> {
  const result = await database
    .prepare(
      "SELECT id, name, is_default FROM subscription_topics WHERE workspace_id = ? ORDER BY name",
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    isDefault: Boolean(row["is_default"]),
  }));
}
