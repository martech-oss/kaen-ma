import type { Context, Hono } from "hono";
import * as z from "zod";

import {
  PermanentChannelError,
  TransientChannelError,
  type ResendHostedTemplate,
} from "@kaenma/channels";
import { uuidv7 } from "@kaenma/database";
import { messagePurposeSchema } from "@kaenma/shared";

import type { AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import { createResendTemplateAdapter, templateCompatibilityError } from "./resend";

const importTemplateSchema = z.object({
  resendTemplateId: z.string().trim().min(1).max(191),
  purpose: messagePurposeSchema,
});

interface TemplateRow {
  id: string;
  name: string;
  purpose: "marketing" | "transactional";
  resend_template_id: string;
  resend_alias: string | null;
  subject: string | null;
  remote_status: "draft" | "published";
  remote_current_version_id: string;
  has_unpublished_versions: number;
  variables: string;
  published_at: string | null;
  last_synced_at: string;
  sync_error: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export function registerTemplateRoutes(api: Hono<AppEnvironment>): void {
  api.get("/email-templates", async (context) => {
    const archived = context.req.query("archived") === "true";
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, name, purpose, resend_template_id, resend_alias, subject,
                remote_status, remote_current_version_id, has_unpublished_versions,
                variables, published_at, last_synced_at, sync_error, archived_at,
                created_at, updated_at
         FROM email_templates
         WHERE workspace_id = ?
           AND archived_at IS ${archived ? "NOT NULL" : "NULL"}
         ORDER BY updated_at DESC LIMIT 200`,
      )
      .bind(context.get("workspace").workspaceId)
      .all<TemplateRow>();
    return context.json({ data: result.results.map(serializeTemplateRow) });
  });

  api.get("/email-templates/:id", async (context) => {
    const row = await readTemplate(
      context.get("database"),
      context.get("workspace").workspaceId,
      context.req.param("id"),
    );
    return row
      ? context.json({ data: serializeTemplateRow(row) })
      : apiError(context, 404, "email_template_not_found", "メールテンプレートが見つかりません");
  });

  api.post("/email-templates", requireRole("marketer"), async (context) => {
    const parsed = importTemplateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const remote = await getRemoteTemplate(context, parsed.data.resendTemplateId);
    if (remote instanceof Response) return remote;
    const existing = await context
      .get("database")
      .prepare("SELECT id FROM email_templates WHERE resend_template_id = ?")
      .bind(remote.id)
      .first<{ id: string }>();
    if (existing) {
      return apiError(
        context,
        409,
        "resend_template_already_registered",
        "このResend Templateは既に登録されています",
      );
    }
    const id = uuidv7();
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO email_templates
         (id, workspace_id, name, purpose, resend_template_id, resend_alias, subject,
          remote_status, remote_current_version_id, has_unpublished_versions,
          variables, published_at, last_synced_at, sync_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        workspaceId,
        remote.name,
        parsed.data.purpose,
        remote.id,
        remote.alias,
        remote.subject,
        remote.status,
        remote.currentVersionId,
        remote.hasUnpublishedVersions ? 1 : 0,
        JSON.stringify(remote.variables),
        remote.publishedAt,
        now,
        templateCompatibilityError(remote, parsed.data.purpose),
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.post("/email-templates/:id/sync", requireRole("marketer"), async (context) => {
    const workspaceId = context.get("workspace").workspaceId;
    const local = await readTemplate(context.get("database"), workspaceId, context.req.param("id"));
    if (!local) {
      return apiError(
        context,
        404,
        "email_template_not_found",
        "メールテンプレートが見つかりません",
      );
    }
    const remote = await getRemoteTemplate(context, local.resend_template_id);
    if (remote instanceof Response) return remote;
    const now = new Date().toISOString();
    await context
      .get("database")
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
        templateCompatibilityError(remote, local.purpose),
        now,
        workspaceId,
        local.id,
      )
      .run();
    return context.json({ data: { synced: true } });
  });

  api.post("/email-templates/:id/archive", requireRole("marketer"), async (context) => {
    const now = new Date().toISOString();
    const result = await context
      .get("database")
      .prepare(
        `UPDATE email_templates SET archived_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(now, now, context.get("workspace").workspaceId, context.req.param("id"))
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "email_template_not_found", "メールテンプレートが見つかりません");
  });
}

async function readTemplate(
  database: AppEnvironment["Variables"]["database"],
  workspaceId: string,
  id: string,
): Promise<TemplateRow | null> {
  return database
    .prepare(
      `SELECT id, name, purpose, resend_template_id, resend_alias, subject,
              remote_status, remote_current_version_id, has_unpublished_versions,
              variables, published_at, last_synced_at, sync_error, archived_at,
              created_at, updated_at
       FROM email_templates WHERE workspace_id = ? AND id = ?`,
    )
    .bind(workspaceId, id)
    .first<TemplateRow>();
}

async function getRemoteTemplate(
  context: Context<AppEnvironment>,
  identifier: string,
): Promise<ResendHostedTemplate | Response> {
  try {
    return await createResendTemplateAdapter(context.env).get(identifier);
  } catch (error) {
    if (error instanceof PermanentChannelError) {
      return apiError(
        context,
        422,
        "resend_template_unavailable",
        "Resend Templateを取得できません",
        error.message,
      );
    }
    if (error instanceof TransientChannelError) {
      return apiError(
        context,
        503,
        "resend_temporarily_unavailable",
        "Resendへ一時的に接続できません",
        error.message,
      );
    }
    throw error;
  }
}

function serializeTemplateRow(row: TemplateRow) {
  return {
    ...row,
    has_unpublished_versions: Boolean(row.has_unpublished_versions),
    variables: JSON.parse(row.variables) as unknown,
    sendable: row.remote_status === "published" && !row.sync_error && !row.archived_at,
  };
}
