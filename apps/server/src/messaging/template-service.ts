import { type EmailTemplate, type EmailTemplateWrite } from "@openengage/core/messaging";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  MessagingRepository,
  type EmailTemplateRecord,
  type OpenEngageDatabase,
} from "@openengage/database";

import { renderContent, renderSubject } from "../rendering/content-renderer";

export async function listEmailTemplates(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<EmailTemplate[]> {
  const rows = await new MessagingRepository(database, workspace).listEmailTemplates(archived);
  return rows.map(toEmailTemplate);
}

export function createEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: EmailTemplateWrite,
): Promise<{ id: string }> {
  return new MessagingRepository(database, workspace).createEmailTemplate(input);
}

export function updateEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: EmailTemplateWrite,
): Promise<boolean> {
  return new MessagingRepository(database, workspace).updateEmailTemplate(id, input);
}

export function publishEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new MessagingRepository(database, workspace).publishEmailTemplate(id);
}

export function previewEmailTemplate(input: Pick<EmailTemplateWrite, "subject" | "content">): {
  subject: string;
  html: string;
  text: string;
} {
  const context = {
    contact: {
      email: "taro@example.com",
      first_name: "太郎",
      last_name: "山田",
      stage: "lead",
      score: 10,
    },
    workspace: { name: "OpenEngage Workspace" },
    message: { brand: "OpenEngage" },
  };
  return {
    subject: renderSubject(input.subject, context),
    ...renderContent(input.content, context),
  };
}

export function archiveEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new MessagingRepository(database, workspace).archiveEmailTemplate(id);
}

function toEmailTemplate(row: EmailTemplateRecord): EmailTemplate {
  return {
    id: row.id,
    name: row.name,
    purpose: "transactional",
    subject: row.draftSubject,
    content: row.draftContent,
    draftRevision: row.draftRevision,
    publishedRevision: row.publishedRevision,
    hasUnpublishedChanges: row.publishedRevision !== row.draftRevision,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sendable: row.publishedRevision !== null && !row.archivedAt,
  };
}
