import type { Hono } from "hono";

import { renderContent } from "@kaenma/email-renderer";
import { contentDocumentSchema } from "@kaenma/shared";

import type { AppEnvironment } from "../env";
import { apiError } from "../middleware";

export function registerPublicLandingRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/p/:workspaceSlug/:pageSlug", async (context) => {
    const page = await context
      .get("database")
      .prepare(
        `SELECT lpv.content_document, o.name AS workspace_name
       FROM landing_pages lp
       JOIN organization o ON o.id = lp.workspace_id
       JOIN landing_page_versions lpv
         ON lpv.id = lp.current_version_id AND lpv.workspace_id = lp.workspace_id
       WHERE o.slug = ? AND lp.slug = ? AND lp.status = 'published'`,
      )
      .bind(context.req.param("workspaceSlug"), context.req.param("pageSlug"))
      .first<{ content_document: string; workspace_name: string }>();
    if (!page) return apiError(context, 404, "page_not_found", "ページが見つかりません");
    const document = contentDocumentSchema.safeParse(JSON.parse(page.content_document));
    if (!document.success) {
      return apiError(context, 500, "page_render_failed", "ページ定義が不正です");
    }
    const rendered = renderContent(document.data, {
      contact: {},
      workspace: { name: page.workspace_name },
    });
    return context.html(rendered.html);
  });
}
