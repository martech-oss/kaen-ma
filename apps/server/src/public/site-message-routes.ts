import type { Hono } from "hono";
import * as z from "zod";

import { uuidv7 } from "@kaenma/database";

import type { AppEnvironment } from "../env";
import { safeJson } from "../http/helpers";
import { apiError } from "../middleware";
import { originAllowed, pagePatternMatches } from "./domain";
import { loadPublicTrackingWorkspace } from "./shared";

export function registerPublicSiteMessageRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/api/public/site-messages/:workspaceSlug", async (context) => {
    const workspace = await loadPublicTrackingWorkspace(
      context.get("database"),
      context.req.param("workspaceSlug"),
    );
    const visitorId = context.req.query("visitorId");
    const pageUrl = context.req.query("url") ?? "";
    if (!workspace || !visitorId || !z.string().uuid().safeParse(visitorId).success) {
      return context.json({ data: [] });
    }
    const origin = context.req.header("origin");
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return context.json({ data: [] });
    }
    const identity = await context
      .get("database")
      .prepare(
        `SELECT contact_id FROM contact_events
       WHERE workspace_id = ? AND visitor_id = ? AND contact_id IS NOT NULL
       ORDER BY occurred_at DESC LIMIT 1`,
      )
      .bind(workspace.id, visitorId)
      .first<{ contact_id: string }>();
    if (!identity) return context.json({ data: [] });
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, headline, body, cta_label, cta_url, page_pattern
       FROM site_messages
       WHERE workspace_id = ? AND status = 'published'
         AND (starts_at IS NULL OR starts_at <= ?)
         AND (ends_at IS NULL OR ends_at >= ?)
       ORDER BY updated_at DESC LIMIT 20`,
      )
      .bind(workspace.id, new Date().toISOString(), new Date().toISOString())
      .all<{
        id: string;
        headline: string;
        body: string;
        cta_label: string;
        cta_url: string | null;
        page_pattern: string;
      }>();
    return context.json({
      data: result.results
        .filter((message) => pagePatternMatches(pageUrl, message.page_pattern))
        .slice(0, 1),
    });
  });

  publicApp.post("/api/public/site-messages/:workspaceSlug/:messageId/events", async (context) => {
    const workspace = await loadPublicTrackingWorkspace(
      context.get("database"),
      context.req.param("workspaceSlug"),
    );
    if (!workspace) return context.json({ data: { accepted: false } }, 202);
    const origin = context.req.header("origin");
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return apiError(context, 403, "tracking_origin_denied", "このドメインは許可されていません");
    }
    const parsed = z
      .object({
        visitorId: z.string().uuid(),
        type: z.enum(["impression", "click"]),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return context.json({ data: { accepted: false } }, 202);
    const identity = await context
      .get("database")
      .prepare(
        `SELECT contact_id FROM contact_events
         WHERE workspace_id = ? AND visitor_id = ? AND contact_id IS NOT NULL
         ORDER BY occurred_at DESC LIMIT 1`,
      )
      .bind(workspace.id, parsed.data.visitorId)
      .first<{ contact_id: string }>();
    if (!identity) return context.json({ data: { accepted: false } }, 202);
    const now = new Date().toISOString();
    const messageId = context.req.param("messageId");
    const counter = parsed.data.type === "impression" ? "impression_count" : "click_count";
    const result = await context
      .get("database")
      .prepare(
        `UPDATE site_messages SET ${counter} = ${counter} + 1, updated_at = updated_at
         WHERE workspace_id = ? AND id = ? AND status = 'published'`,
      )
      .bind(workspace.id, messageId)
      .run();
    if (result.meta.changes !== 1) {
      return context.json({ data: { accepted: false } }, 202);
    }
    await context
      .get("database")
      .prepare(
        `INSERT INTO contact_events
         (id, workspace_id, contact_id, visitor_id, type, resource_type,
          resource_id, properties, occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'site_message', ?, '{}', ?, ?)`,
      )
      .bind(
        uuidv7(),
        workspace.id,
        identity.contact_id,
        parsed.data.visitorId,
        parsed.data.type === "impression" ? "site_message_viewed" : "site_message_clicked",
        messageId,
        now,
        now,
      )
      .run();
    return context.json({ data: { accepted: true } }, 202);
  });
}
