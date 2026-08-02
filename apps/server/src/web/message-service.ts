import { WebRepository, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/orpc";
import type { SiteMessage, SiteMessageWrite } from "@kaenma/orpc";

export async function listSiteMessages(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<SiteMessage[]> {
  const rows = await new WebRepository(database, workspace).listSiteMessages();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: publishedStatus(row.status),
    headline: row.headline,
    body: row.body,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    pagePattern: row.pagePattern,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    impressionCount: row.impressionCount,
    clickCount: row.clickCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function createSiteMessage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: SiteMessageWrite,
): Promise<{ id: string }> {
  return new WebRepository(database, workspace).createSiteMessage(input);
}

export async function updateSiteMessage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: SiteMessageWrite,
): Promise<boolean> {
  return new WebRepository(database, workspace).updateSiteMessage(id, input);
}

export async function archiveSiteMessage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new WebRepository(database, workspace).archiveSiteMessage(id);
}

function publishedStatus(value: unknown): "draft" | "published" {
  return value === "published" ? "published" : "draft";
}
