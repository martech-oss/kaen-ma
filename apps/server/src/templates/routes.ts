import { Hono } from "hono";
import * as z from "zod";

import { uuidv7 } from "@kaenma/database";
import { renderContent } from "@kaenma/email-renderer";
import { contentDocumentSchema, messagePurposeSchema } from "@kaenma/shared";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { readMessageVariableValues } from "../message-variables/routes";
import { apiError, requireRole } from "../middleware";

const emailTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(191),
  purpose: messagePurposeSchema,
  subject: z.string().trim().min(1).max(998),
  previewText: z.string().max(500).default(""),
  content: contentDocumentSchema,
});

export function registerTemplateRoutes(api: Hono<AppEnvironment>): void {
  api.get("/email-templates", async (context) => {
    const workspace = context.get("workspace");
    const archived = context.req.query("archived") === "true";
    const result = await context
      .get("database")
      .prepare(
        `SELECT et.id, et.name, et.purpose, et.status, et.current_version_id,
              et.created_at, et.updated_at, ev.version, ev.subject,
              ev.preview_text
       FROM email_templates et
       LEFT JOIN email_template_versions ev
         ON ev.workspace_id = et.workspace_id AND ev.id = et.current_version_id
       WHERE et.workspace_id = ?
         AND et.status ${archived ? "=" : "<>"} 'archived'
       ORDER BY et.updated_at DESC LIMIT 200`,
      )
      .bind(workspace.workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.get("/email-templates/:id", async (context) => {
    const row = await context
      .get("database")
      .prepare(
        `SELECT et.id, et.name, et.purpose, et.status, et.current_version_id,
              et.created_at, et.updated_at, ev.version, ev.subject,
              ev.preview_text, ev.content_document
       FROM email_templates et
       JOIN email_template_versions ev
         ON ev.workspace_id = et.workspace_id AND ev.id = et.current_version_id
       WHERE et.workspace_id = ? AND et.id = ?`,
      )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first<{ content_document: string } & Record<string, unknown>>();
    return row
      ? context.json({
          data: {
            ...row,
            content_document: JSON.parse(row.content_document) as unknown,
          },
        })
      : apiError(context, 404, "email_template_not_found", "メールテンプレートが見つかりません");
  });

  api.post("/email-templates", requireRole("marketer"), async (context) => {
    const parsed = emailTemplateInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    const rendered = renderContent(parsed.data.content, {
      contact: {},
      workspace: {},
      message: await readMessageVariableValues(context.get("database"), workspace.workspaceId),
    });
    await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `INSERT INTO email_templates
         (id, workspace_id, name, purpose, status, current_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        )
        .bind(
          id,
          workspace.workspaceId,
          parsed.data.name,
          parsed.data.purpose,
          versionId,
          now,
          now,
        ),
      context
        .get("database")
        .prepare(
          `INSERT INTO email_template_versions
         (id, workspace_id, template_id, version, subject, preview_text,
          content_document, html, text, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          versionId,
          workspace.workspaceId,
          id,
          parsed.data.subject,
          parsed.data.previewText,
          JSON.stringify(parsed.data.content),
          rendered.html,
          rendered.text,
          now,
        ),
    ]);
    return context.json({ data: { id, versionId } }, 201);
  });

  api.put("/email-templates/:id", requireRole("marketer"), async (context) => {
    const parsed = emailTemplateInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const template = await context
      .get("database")
      .prepare(
        `SELECT id, status FROM email_templates
       WHERE workspace_id = ? AND id = ?`,
      )
      .bind(workspaceId, context.req.param("id"))
      .first<{ id: string; status: string }>();
    if (!template) {
      return apiError(
        context,
        404,
        "email_template_not_found",
        "メールテンプレートが見つかりません",
      );
    }
    if (template.status === "archived") {
      return apiError(
        context,
        409,
        "email_template_archived",
        "アーカイブ済みのテンプレートは編集できません",
      );
    }
    const latest = await context
      .get("database")
      .prepare(
        `SELECT COALESCE(MAX(version), 0) AS version
       FROM email_template_versions WHERE workspace_id = ? AND template_id = ?`,
      )
      .bind(workspaceId, template.id)
      .first<{ version: number }>();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    const rendered = renderContent(parsed.data.content, {
      contact: {},
      workspace: {},
      message: await readMessageVariableValues(context.get("database"), workspaceId),
    });
    await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `INSERT INTO email_template_versions
         (id, workspace_id, template_id, version, subject, preview_text,
          content_document, html, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          versionId,
          workspaceId,
          template.id,
          (latest?.version ?? 0) + 1,
          parsed.data.subject,
          parsed.data.previewText,
          JSON.stringify(parsed.data.content),
          rendered.html,
          rendered.text,
          now,
        ),
      context
        .get("database")
        .prepare(
          `UPDATE email_templates
         SET name = ?, purpose = ?, status = 'draft', current_version_id = ?,
             updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
        )
        .bind(parsed.data.name, parsed.data.purpose, versionId, now, workspaceId, template.id),
    ]);
    return context.json({ data: { updated: true, versionId } });
  });

  api.post("/email-templates/:id/archive", requireRole("marketer"), async (context) => {
    const now = new Date().toISOString();
    const result = await context
      .get("database")
      .prepare(
        `UPDATE email_templates SET status = 'archived', updated_at = ?
         WHERE workspace_id = ? AND id = ? AND status <> 'archived'`,
      )
      .bind(now, context.get("workspace").workspaceId, context.req.param("id"))
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "email_template_not_found", "メールテンプレートが見つかりません");
  });
}
