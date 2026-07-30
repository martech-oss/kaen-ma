import {
  PermanentChannelError,
  TransientChannelError,
  type ResendHostedTemplate,
} from "@kaenma/channels";
import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/shared";
import type {
  BroadcastSegmentOption,
  BroadcastStatus,
  BroadcastWrite,
  EmailCampaign,
  EmailTemplate,
  MessageVariable,
  MessageVariableWrite,
  ResendTemplateVariable,
  SubscriptionTopicOption,
} from "@kaenma/shared/emails";

import { hasValidBroadcastResources } from "../broadcasts/routes";
import type { RuntimeEnv } from "../env";
import { createResendTemplateAdapter, templateCompatibilityError } from "../templates/resend";
import { primitiveString } from "../values";

/** Raised when Resend cannot serve a template; `transient` picks the status. */
export class RemoteTemplateError extends Error {
  public constructor(
    public readonly transient: boolean,
    message: string,
  ) {
    super(message);
    this.name = "RemoteTemplateError";
  }
}

export class TemplateAlreadyRegisteredError extends Error {}

function num(value: unknown): number {
  return Number(value ?? 0);
}

function text(value: unknown): string {
  return primitiveString(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : primitiveString(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function listEmailCampaigns(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<EmailCampaign[]> {
  const result = await database
    .prepare(
      `SELECT b.id, b.name, b.segment_id, b.template_id, b.topic_id,
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
         ON et.workspace_id = b.workspace_id AND et.id = b.template_id
       WHERE b.workspace_id = ?
         AND ${archived ? "b.archived_at IS NOT NULL" : "b.archived_at IS NULL"}
       ORDER BY b.updated_at DESC LIMIT 200`,
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: text(row["id"]),
    name: text(row["name"]),
    segmentId: text(row["segment_id"]),
    templateId: text(row["template_id"]),
    topicId: nullableText(row["topic_id"]),
    status: text(row["status"]) as BroadcastStatus,
    scheduledAt: nullableText(row["scheduled_at"]),
    startedAt: nullableText(row["started_at"]),
    completedAt: nullableText(row["completed_at"]),
    archivedAt: nullableText(row["archived_at"]),
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
    segmentName: text(row["segment_name"]),
    memberCount: num(row["member_count"]),
    templateName: text(row["template_name"]),
    subject: nullableText(row["subject"]),
    recipientCount: num(row["recipient_count"]),
    sentCount: num(row["sent_count"]),
    deliveredCount: num(row["delivered_count"]),
  }));
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

function toEmailTemplate(row: Record<string, unknown>): EmailTemplate {
  const remoteStatus = row["remote_status"] === "published" ? "published" : "draft";
  const syncError = nullableText(row["sync_error"]);
  const archivedAt = nullableText(row["archived_at"]);
  return {
    id: text(row["id"]),
    name: text(row["name"]),
    purpose: row["purpose"] === "transactional" ? "transactional" : "marketing",
    resendTemplateId: text(row["resend_template_id"]),
    resendAlias: nullableText(row["resend_alias"]),
    subject: nullableText(row["subject"]),
    remoteStatus,
    remoteCurrentVersionId: text(row["remote_current_version_id"]),
    hasUnpublishedVersions: Boolean(row["has_unpublished_versions"]),
    variables: parseJson<ResendTemplateVariable[]>(row["variables"], []),
    publishedAt: nullableText(row["published_at"]),
    lastSyncedAt: text(row["last_synced_at"]),
    syncError,
    archivedAt,
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
    sendable: remoteStatus === "published" && !syncError && !archivedAt,
  };
}

const TEMPLATE_COLUMNS = `id, name, purpose, resend_template_id, resend_alias, subject,
              remote_status, remote_current_version_id, has_unpublished_versions,
              variables, published_at, last_synced_at, sync_error, archived_at,
              created_at, updated_at`;

export async function listEmailTemplates(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<EmailTemplate[]> {
  const result = await database
    .prepare(
      `SELECT ${TEMPLATE_COLUMNS}
       FROM email_templates
       WHERE workspace_id = ?
         AND archived_at IS ${archived ? "NOT NULL" : "NULL"}
       ORDER BY updated_at DESC LIMIT 200`,
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map(toEmailTemplate);
}

async function fetchRemoteTemplate(
  env: RuntimeEnv,
  identifier: string,
): Promise<ResendHostedTemplate> {
  try {
    return await createResendTemplateAdapter(env).get(identifier);
  } catch (error) {
    if (error instanceof PermanentChannelError) throw new RemoteTemplateError(false, error.message);
    if (error instanceof TransientChannelError) throw new RemoteTemplateError(true, error.message);
    throw error;
  }
}

export async function importEmailTemplate(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: { resendTemplateId: string; purpose: "marketing" | "transactional" },
): Promise<{ id: string }> {
  const remote = await fetchRemoteTemplate(env, input.resendTemplateId);
  const existing = await database
    .prepare("SELECT id FROM email_templates WHERE resend_template_id = ?")
    .bind(remote.id)
    .first<{ id: string }>();
  if (existing) throw new TemplateAlreadyRegisteredError();
  const id = uuidv7();
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO email_templates
       (id, workspace_id, name, purpose, resend_template_id, resend_alias, subject,
        remote_status, remote_current_version_id, has_unpublished_versions,
        variables, published_at, last_synced_at, sync_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      workspace.workspaceId,
      remote.name,
      input.purpose,
      remote.id,
      remote.alias,
      remote.subject,
      remote.status,
      remote.currentVersionId,
      remote.hasUnpublishedVersions ? 1 : 0,
      JSON.stringify(remote.variables),
      remote.publishedAt,
      now,
      templateCompatibilityError(remote, input.purpose),
      now,
      now,
    )
    .run();
  return { id };
}

export async function syncEmailTemplate(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  id: string,
): Promise<boolean> {
  const workspaceId = workspace.workspaceId;
  const local = await database
    .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM email_templates WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, id)
    .first<Record<string, unknown>>();
  if (!local) return false;
  const purpose = local["purpose"] === "transactional" ? "transactional" : "marketing";
  const remote = await fetchRemoteTemplate(env, text(local["resend_template_id"]));
  const now = new Date().toISOString();
  await database
    .prepare(
      `UPDATE email_templates
       SET name = ?, resend_alias = ?, subject = ?, remote_status = ?,
           remote_current_version_id = ?, has_unpublished_versions = ?,
           variables = ?, published_at = ?, last_synced_at = ?, sync_error = ?,
           updated_at = ?
       WHERE workspace_id = ? AND id = ?`,
    )
    .bind(
      remote.name,
      remote.alias,
      remote.subject,
      remote.status,
      remote.currentVersionId,
      remote.hasUnpublishedVersions ? 1 : 0,
      JSON.stringify(remote.variables),
      remote.publishedAt,
      now,
      templateCompatibilityError(remote, purpose),
      now,
      workspaceId,
      text(local["id"]),
    )
    .run();
  return true;
}

export async function archiveEmailTemplate(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE email_templates SET archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
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
    id: text(row["id"]),
    key: text(row["key"]),
    name: text(row["name"]),
    value: text(row["value"]),
    description: text(row["description"]),
    archivedAt: nullableText(row["archived_at"]),
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
  }));
}

export class VariableConflictError extends Error {}

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
    id: text(row["id"]),
    name: text(row["name"]),
    memberCount: num(row["member_count"]),
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
    id: text(row["id"]),
    name: text(row["name"]),
    isDefault: Boolean(row["is_default"]),
  }));
}
