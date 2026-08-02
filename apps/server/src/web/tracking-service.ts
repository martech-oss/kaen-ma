import { WebRepository, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/orpc";
import type { SiteTracking, SiteTrackingWrite } from "@kaenma/orpc";

export async function getSiteTracking(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<SiteTracking> {
  const overview = await new WebRepository(database, workspace).getTrackingOverview();
  return {
    enabled: overview.settings?.enabled === 1,
    allowedDomains: overview.settings?.allowedDomains ?? [],
    consentMode: "required",
    workspaceSlug: overview.workspaceSlug ?? "",
    summary: {
      pageViews: overview.summary.pageViews,
      uniqueVisitors: overview.summary.uniqueVisitors,
      identifiedContacts: overview.summary.identifiedContacts,
    },
    topPages: overview.topPages.map((row) => ({
      url: row.url ?? "",
      views: row.views,
    })),
    recentEvents: overview.recentEvents.map((row) => ({
      visitorId: row.visitorId ?? "",
      contactId: row.contactId,
      resourceId: row.resourceId ?? "",
      properties: row.properties,
      occurredAt: row.occurredAt,
    })),
    updatedAt: overview.settings?.updatedAt ?? null,
  };
}

export async function saveSiteTracking(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: SiteTrackingWrite,
): Promise<void> {
  await new WebRepository(database, workspace).saveTrackingSettings(input);
}
