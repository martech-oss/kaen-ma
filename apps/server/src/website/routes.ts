import { Hono } from "hono";
import * as z from "zod";

import { uuidv7 } from "@kaenma/database";

import { type AppEnvironment } from "../env";
import { parseJsonColumns, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import { isValidDomain, normalizeDomain } from "../public/domain";

export function registerWebsiteRoutes(api: Hono<AppEnvironment>): void {
  const messageInputSchema = z.object({
    name: z.string().trim().min(1).max(191),
    status: z.enum(["draft", "published"]).default("draft"),
    headline: z.string().trim().min(1).max(191),
    body: z.string().max(2_000).default(""),
    ctaLabel: z.string().max(100).default(""),
    ctaUrl: z.url().max(2_000).nullable().default(null),
    pagePattern: z.string().trim().min(1).max(500).default("*"),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
  });

  api.get("/site-messages", async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, name, status, headline, body, cta_label, cta_url,
              page_pattern, starts_at, ends_at, impression_count, click_count,
              created_at, updated_at
       FROM site_messages
       WHERE workspace_id = ? AND status != 'archived'
       ORDER BY updated_at DESC`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/site-messages", requireRole("marketer"), async (context) => {
    const parsed = messageInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const id = uuidv7();
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO site_messages
       (id, workspace_id, name, status, headline, body, cta_label, cta_url,
        page_pattern, starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.status,
        parsed.data.headline,
        parsed.data.body,
        parsed.data.ctaLabel,
        parsed.data.ctaUrl,
        parsed.data.pagePattern,
        parsed.data.startsAt,
        parsed.data.endsAt,
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.patch("/site-messages/:id", requireRole("marketer"), async (context) => {
    const parsed = messageInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await context
      .get("database")
      .prepare(
        `UPDATE site_messages
       SET name = ?, status = ?, headline = ?, body = ?, cta_label = ?,
           cta_url = ?, page_pattern = ?, starts_at = ?, ends_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(
        parsed.data.name,
        parsed.data.status,
        parsed.data.headline,
        parsed.data.body,
        parsed.data.ctaLabel,
        parsed.data.ctaUrl,
        parsed.data.pagePattern,
        parsed.data.startsAt,
        parsed.data.endsAt,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { id: context.req.param("id") } })
      : apiError(context, 404, "site_message_not_found", "サイトメッセージが見つかりません");
  });

  api.post("/site-messages/:id/archive", requireRole("admin"), async (context) => {
    const now = new Date().toISOString();
    const result = await context
      .get("database")
      .prepare(
        `UPDATE site_messages
       SET status = 'archived', archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(now, now, context.get("workspace").workspaceId, context.req.param("id"))
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "site_message_not_found", "サイトメッセージが見つかりません");
  });

  api.get("/site-tracking", async (context) => {
    const database = context.get("database");
    const workspace = context.get("workspace");
    const [settings, summary, topPages, recentEvents, organization] = await Promise.all([
      database
        .prepare(
          `SELECT enabled, allowed_domains, consent_mode, created_at, updated_at
         FROM site_tracking_settings WHERE workspace_id = ?`,
        )
        .bind(workspace.workspaceId)
        .first<{
          enabled: number;
          allowed_domains: string;
          consent_mode: string;
          created_at: string;
          updated_at: string;
        }>(),
      database
        .prepare(
          `SELECT COUNT(*) AS page_views,
                COUNT(DISTINCT visitor_id) AS unique_visitors,
                COUNT(DISTINCT contact_id) AS identified_contacts
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
           AND occurred_at >= datetime('now', '-30 days')`,
        )
        .bind(workspace.workspaceId)
        .first<{
          page_views: number;
          unique_visitors: number;
          identified_contacts: number;
        }>(),
      database
        .prepare(
          `SELECT resource_id AS url, COUNT(*) AS views
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
           AND occurred_at >= datetime('now', '-30 days')
           AND resource_id IS NOT NULL
         GROUP BY resource_id ORDER BY views DESC LIMIT 10`,
        )
        .bind(workspace.workspaceId)
        .all(),
      database
        .prepare(
          `SELECT visitor_id, contact_id, resource_id, properties, occurred_at
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
         ORDER BY occurred_at DESC LIMIT 20`,
        )
        .bind(workspace.workspaceId)
        .all(),
      database
        .prepare("SELECT slug FROM organization WHERE id = ?")
        .bind(workspace.workspaceId)
        .first<{ slug: string }>(),
    ]);
    return context.json({
      data: {
        enabled: settings?.enabled === 1,
        allowedDomains: settings ? (JSON.parse(settings.allowed_domains) as string[]) : [],
        consentMode: settings?.consent_mode ?? "required",
        workspaceSlug: organization?.slug ?? "",
        summary: {
          pageViews: Number(summary?.page_views ?? 0),
          uniqueVisitors: Number(summary?.unique_visitors ?? 0),
          identifiedContacts: Number(summary?.identified_contacts ?? 0),
        },
        topPages: topPages.results,
        recentEvents: recentEvents.results.map(parseJsonColumns(["properties"])),
        updatedAt: settings?.updated_at ?? null,
      },
    });
  });

  api.put("/site-tracking", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        enabled: z.boolean(),
        allowedDomains: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(253)
              .transform(normalizeDomain)
              .refine(isValidDomain, "有効なドメインを入力してください"),
          )
          .max(50),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    if (parsed.data.enabled && parsed.data.allowedDomains.length === 0) {
      return apiError(
        context,
        422,
        "tracking_domain_required",
        "トラッキングを有効にするには許可ドメインが必要です",
      );
    }
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO site_tracking_settings
       (workspace_id, enabled, allowed_domains, consent_mode, created_at, updated_at)
       VALUES (?, ?, ?, 'required', ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         enabled = excluded.enabled,
         allowed_domains = excluded.allowed_domains,
         updated_at = excluded.updated_at`,
      )
      .bind(
        context.get("workspace").workspaceId,
        parsed.data.enabled ? 1 : 0,
        JSON.stringify([...new Set(parsed.data.allowedDomains)]),
        now,
        now,
      )
      .run();
    return context.json({ data: { saved: true } });
  });
}
