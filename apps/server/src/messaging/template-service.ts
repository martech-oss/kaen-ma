import {
  PermanentChannelError,
  TransientChannelError,
  type ResendHostedTemplate,
} from "@openengage/channels";
import {
  MessagingRepository,
  type EmailTemplateRecord,
  type OpenEngageDatabase,
} from "@openengage/database";
import type { WorkspaceContext } from "@openengage/orpc";
import type { EmailTemplate, ResendTemplateVariable } from "@openengage/orpc";

import type { RuntimeEnv } from "../env";
import { createResendTemplateAdapter, templateCompatibilityError } from "../messaging/resend";
import { parseJsonValue } from "../platform/values";

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

export async function listEmailTemplates(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<EmailTemplate[]> {
  const rows = await new MessagingRepository(database, workspace).listEmailTemplates(archived);
  return rows.map(toEmailTemplate);
}

export async function importEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: { resendTemplateId: string; purpose: "marketing" | "transactional" },
): Promise<{ id: string }> {
  const remote = await fetchRemoteTemplate(env, input.resendTemplateId);
  const repository = new MessagingRepository(database, workspace);
  const existing = await repository.findEmailTemplateByResendId(remote.id);
  if (existing) throw new TemplateAlreadyRegisteredError();
  return await repository.createEmailTemplate({
    name: remote.name,
    purpose: input.purpose,
    resendTemplateId: remote.id,
    resendAlias: remote.alias,
    subject: remote.subject,
    remoteStatus: remote.status,
    remoteCurrentVersionId: remote.currentVersionId,
    hasUnpublishedVersions: remote.hasUnpublishedVersions,
    variables: JSON.stringify(remote.variables),
    publishedAt: remote.publishedAt,
    syncError: templateCompatibilityError(remote, input.purpose),
  });
}

export async function syncEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  id: string,
): Promise<boolean> {
  const repository = new MessagingRepository(database, workspace);
  const local = await repository.getEmailTemplate(id);
  if (!local) return false;
  const purpose = local.purpose === "transactional" ? "transactional" : "marketing";
  const remote = await fetchRemoteTemplate(env, local.resendTemplateId);
  await repository.updateEmailTemplateFromRemote(local.id, {
    name: remote.name,
    resendAlias: remote.alias,
    subject: remote.subject,
    remoteStatus: remote.status,
    remoteCurrentVersionId: remote.currentVersionId,
    hasUnpublishedVersions: remote.hasUnpublishedVersions,
    variables: JSON.stringify(remote.variables),
    publishedAt: remote.publishedAt,
    syncError: templateCompatibilityError(remote, purpose),
  });
  return true;
}

export function archiveEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new MessagingRepository(database, workspace).archiveEmailTemplate(id);
}

function toEmailTemplate(row: EmailTemplateRecord): EmailTemplate {
  const remoteStatus = row.remoteStatus === "published" ? "published" : "draft";
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose === "transactional" ? "transactional" : "marketing",
    resendTemplateId: row.resendTemplateId,
    resendAlias: row.resendAlias,
    subject: row.subject,
    remoteStatus,
    remoteCurrentVersionId: row.remoteCurrentVersionId,
    hasUnpublishedVersions: row.hasUnpublishedVersions,
    variables: parseJsonValue<ResendTemplateVariable[]>(row.variables, []),
    publishedAt: row.publishedAt,
    lastSyncedAt: row.lastSyncedAt,
    syncError: row.syncError,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sendable: remoteStatus === "published" && !row.syncError && !row.archivedAt,
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
