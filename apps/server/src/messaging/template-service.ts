import {
  PermanentChannelError,
  TransientChannelError,
  type ResendHostedTemplate,
} from "@kaenma/channels";
import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/orpc";
import type { EmailTemplate, ResendTemplateVariable } from "@kaenma/orpc";

import type { RuntimeEnv } from "../env";
import { createResendTemplateAdapter, templateCompatibilityError } from "../messaging/resend";
import { nullablePrimitiveString, parseJsonValue, primitiveString } from "../platform/values";

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

export class TemplateAlreadyRegisteredError extends Error {
  public override readonly name = "TemplateAlreadyRegisteredError";
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
  const remote = await fetchRemoteTemplate(env, primitiveString(local["resend_template_id"]));
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
      primitiveString(local["id"]),
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

function toEmailTemplate(row: Record<string, unknown>): EmailTemplate {
  const remoteStatus = row["remote_status"] === "published" ? "published" : "draft";
  const syncError = nullablePrimitiveString(row["sync_error"]);
  const archivedAt = nullablePrimitiveString(row["archived_at"]);
  return {
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    purpose: row["purpose"] === "transactional" ? "transactional" : "marketing",
    resendTemplateId: primitiveString(row["resend_template_id"]),
    resendAlias: nullablePrimitiveString(row["resend_alias"]),
    subject: nullablePrimitiveString(row["subject"]),
    remoteStatus,
    remoteCurrentVersionId: primitiveString(row["remote_current_version_id"]),
    hasUnpublishedVersions: Boolean(row["has_unpublished_versions"]),
    variables: parseJsonValue<ResendTemplateVariable[]>(row["variables"], []),
    publishedAt: nullablePrimitiveString(row["published_at"]),
    lastSyncedAt: primitiveString(row["last_synced_at"]),
    syncError,
    archivedAt,
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
    sendable: remoteStatus === "published" && !syncError && !archivedAt,
  };
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
