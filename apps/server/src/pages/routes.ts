import type { Hono } from "hono";
import * as z from "zod";

import { uuidv7 } from "@kaenma/database";
import { contentDocumentSchema } from "@kaenma/shared";

import type { AppEnvironment } from "../env";
import { parseJsonColumns, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

export function registerPageRoutes(api: Hono<AppEnvironment>): void {
  api.get("/pages", async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `SELECT lp.id, lp.name, lp.slug, lp.status, lp.current_version_id,
                lp.created_at, lp.updated_at, lpv.version, lpv.content_document
         FROM landing_pages lp
         LEFT JOIN landing_page_versions lpv
           ON lpv.workspace_id = lp.workspace_id AND lpv.id = lp.current_version_id
         WHERE lp.workspace_id = ? AND lp.status != 'archived'
         ORDER BY lp.updated_at DESC`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({
      data: result.results.map(parseJsonColumns(["content_document"])),
    });
  });

  api.post("/pages", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        status: z.enum(["draft", "published"]).default("draft"),
        content: contentDocumentSchema,
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `INSERT INTO landing_pages
           (id, workspace_id, name, slug, status, current_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          workspace.workspaceId,
          parsed.data.name,
          parsed.data.slug,
          parsed.data.status,
          versionId,
          now,
          now,
        ),
      context
        .get("database")
        .prepare(
          `INSERT INTO landing_page_versions
           (id, workspace_id, page_id, version, content_document, published_at, created_at)
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(
          versionId,
          workspace.workspaceId,
          id,
          JSON.stringify(parsed.data.content),
          parsed.data.status === "published" ? now : null,
          now,
        ),
    ]);
    return context.json({ data: { id, versionId } }, 201);
  });

  api.patch("/pages/:id", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        status: z.enum(["draft", "published"]),
        content: contentDocumentSchema,
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const page = await context
      .get("database")
      .prepare(
        `SELECT id, status,
                COALESCE((SELECT MAX(version) FROM landing_page_versions
                          WHERE workspace_id = ? AND page_id = landing_pages.id), 0) AS version
         FROM landing_pages WHERE workspace_id = ? AND id = ?`,
      )
      .bind(workspaceId, workspaceId, context.req.param("id"))
      .first<{ id: string; status: string; version: number }>();
    if (!page) return apiError(context, 404, "page_not_found", "ページが見つかりません");
    if (page.status === "archived") {
      return apiError(context, 409, "page_archived", "アーカイブ済みページは編集できません");
    }
    const versionId = uuidv7();
    const now = new Date().toISOString();
    await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `INSERT INTO landing_page_versions
           (id, workspace_id, page_id, version, content_document, published_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          versionId,
          workspaceId,
          page.id,
          page.version + 1,
          JSON.stringify(parsed.data.content),
          parsed.data.status === "published" ? now : null,
          now,
        ),
      context
        .get("database")
        .prepare(
          `UPDATE landing_pages
           SET name = ?, slug = ?, status = ?, current_version_id = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
        )
        .bind(
          parsed.data.name,
          parsed.data.slug,
          parsed.data.status,
          versionId,
          now,
          workspaceId,
          page.id,
        ),
    ]);
    return context.json({ data: { id: page.id, versionId } });
  });

  api.post("/pages/:id/archive", requireRole("admin"), async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `UPDATE landing_pages SET status = 'archived', updated_at = ?
         WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(new Date().toISOString(), context.get("workspace").workspaceId, context.req.param("id"))
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "page_not_found", "ページが見つかりません");
  });
}
