import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";

import { landingPages, landingPageVersions, organization } from "@kaenma/database";
import { renderContent } from "@kaenma/content-renderer";
import { contentDocumentSchema } from "@kaenma/orpc";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";

export function registerPublicLandingRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/p/:workspaceSlug/:pageSlug", async (context) => {
    const [page] = await context
      .get("database")
      .orm.select({
        contentDocument: landingPageVersions.contentDocument,
        workspaceName: organization.name,
      })
      .from(landingPages)
      .innerJoin(organization, eq(organization.id, landingPages.workspaceId))
      .innerJoin(
        landingPageVersions,
        and(
          eq(landingPageVersions.id, landingPages.currentVersionId),
          eq(landingPageVersions.workspaceId, landingPages.workspaceId),
        ),
      )
      .where(
        and(
          eq(organization.slug, context.req.param("workspaceSlug")),
          eq(landingPages.slug, context.req.param("pageSlug")),
          eq(landingPages.status, "published"),
        ),
      )
      .limit(1);
    if (!page) return apiError(context, 404, "page_not_found", "ページが見つかりません");
    const document = contentDocumentSchema.safeParse(JSON.parse(page.contentDocument));
    if (!document.success) {
      return apiError(context, 500, "page_render_failed", "ページ定義が不正です");
    }
    const rendered = renderContent(document.data, {
      contact: {},
      workspace: { name: page.workspaceName },
    });
    return context.html(rendered.html);
  });
}
