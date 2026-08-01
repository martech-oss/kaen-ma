import type { KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/shared";
import type { SiteTracking, SiteTrackingWrite } from "@kaenma/shared/website";

import {
  isRecord,
  nullablePrimitiveString,
  numericValue,
  parseJsonValue,
  primitiveString,
} from "../platform/values";

export async function getSiteTracking(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<SiteTracking> {
  const workspaceId = workspace.workspaceId;
  const [settings, summary, topPages, recentEvents, organization] = await Promise.all([
    database
      .prepare(
        `SELECT enabled, allowed_domains, consent_mode, created_at, updated_at
         FROM site_tracking_settings WHERE workspace_id = ?`,
      )
      .bind(workspaceId)
      .first<{ enabled: number; allowed_domains: string; updated_at: string }>(),
    database
      .prepare(
        `SELECT COUNT(*) AS page_views,
                COUNT(DISTINCT visitor_id) AS unique_visitors,
                COUNT(DISTINCT contact_id) AS identified_contacts
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
           AND occurred_at >= datetime('now', '-30 days')`,
      )
      .bind(workspaceId)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT resource_id AS url, COUNT(*) AS views
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
           AND occurred_at >= datetime('now', '-30 days')
           AND resource_id IS NOT NULL
         GROUP BY resource_id ORDER BY views DESC LIMIT 10`,
      )
      .bind(workspaceId)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT visitor_id, contact_id, resource_id, properties, occurred_at
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
         ORDER BY occurred_at DESC LIMIT 20`,
      )
      .bind(workspaceId)
      .all<Record<string, unknown>>(),
    database.prepare("SELECT slug FROM organization WHERE id = ?").bind(workspaceId).first<{
      slug: string;
    }>(),
  ]);
  return {
    enabled: settings?.enabled === 1,
    allowedDomains: settings ? parseJsonValue<string[]>(settings.allowed_domains, []) : [],
    consentMode: "required",
    workspaceSlug: organization?.slug ?? "",
    summary: {
      pageViews: numericValue(summary?.["page_views"]),
      uniqueVisitors: numericValue(summary?.["unique_visitors"]),
      identifiedContacts: numericValue(summary?.["identified_contacts"]),
    },
    topPages: topPages.results.map((row) => ({
      url: primitiveString(row["url"]),
      views: numericValue(row["views"]),
    })),
    recentEvents: recentEvents.results.map((row) => {
      const properties = parseJsonValue<unknown>(row["properties"], {});
      return {
        visitorId: primitiveString(row["visitor_id"]),
        contactId: nullablePrimitiveString(row["contact_id"]),
        resourceId: primitiveString(row["resource_id"]),
        properties: isRecord(properties) ? properties : {},
        occurredAt: primitiveString(row["occurred_at"]),
      };
    }),
    updatedAt: settings?.updated_at ?? null,
  };
}

export async function saveSiteTracking(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: SiteTrackingWrite,
): Promise<void> {
  const now = new Date().toISOString();
  await database
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
      workspace.workspaceId,
      input.enabled ? 1 : 0,
      JSON.stringify([...new Set(input.allowedDomains)]),
      now,
      now,
    )
    .run();
}
