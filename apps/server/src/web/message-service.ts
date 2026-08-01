import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/orpc";
import type { SiteMessage, SiteMessageWrite } from "@kaenma/orpc";

import { nullablePrimitiveString, numericValue, primitiveString } from "../platform/values";

export async function listSiteMessages(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<SiteMessage[]> {
  const result = await database
    .prepare(
      `SELECT id, name, status, headline, body, cta_label, cta_url,
              page_pattern, starts_at, ends_at, impression_count, click_count,
              created_at, updated_at
       FROM site_messages
       WHERE workspace_id = ? AND status != 'archived'
       ORDER BY updated_at DESC`,
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    status: publishedStatus(row["status"]),
    headline: primitiveString(row["headline"]),
    body: primitiveString(row["body"]),
    ctaLabel: primitiveString(row["cta_label"]),
    ctaUrl: nullablePrimitiveString(row["cta_url"]),
    pagePattern: primitiveString(row["page_pattern"]),
    startsAt: nullablePrimitiveString(row["starts_at"]),
    endsAt: nullablePrimitiveString(row["ends_at"]),
    impressionCount: numericValue(row["impression_count"]),
    clickCount: numericValue(row["click_count"]),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
  }));
}

export async function createSiteMessage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: SiteMessageWrite,
): Promise<{ id: string }> {
  const id = uuidv7();
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO site_messages
       (id, workspace_id, name, status, headline, body, cta_label, cta_url,
        page_pattern, starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      workspace.workspaceId,
      input.name,
      input.status,
      input.headline,
      input.body,
      input.ctaLabel,
      input.ctaUrl,
      input.pagePattern,
      input.startsAt,
      input.endsAt,
      now,
      now,
    )
    .run();
  return { id };
}

export async function updateSiteMessage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: SiteMessageWrite,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE site_messages
       SET name = ?, status = ?, headline = ?, body = ?, cta_label = ?,
           cta_url = ?, page_pattern = ?, starts_at = ?, ends_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
    .bind(
      input.name,
      input.status,
      input.headline,
      input.body,
      input.ctaLabel,
      input.ctaUrl,
      input.pagePattern,
      input.startsAt,
      input.endsAt,
      new Date().toISOString(),
      workspace.workspaceId,
      id,
    )
    .run();
  return result.meta.changes === 1;
}

export async function archiveSiteMessage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE site_messages
       SET status = 'archived', archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
    .bind(now, now, workspace.workspaceId, id)
    .run();
  return result.meta.changes === 1;
}

function publishedStatus(value: unknown): "draft" | "published" {
  return value === "published" ? "published" : "draft";
}
