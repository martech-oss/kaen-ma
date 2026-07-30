import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { ContentDocument, WorkspaceContext } from "@kaenma/shared";
import type {
  LandingPage,
  LandingPageWrite,
  SignupForm,
  SignupFormDefinition,
  SignupFormWrite,
  SiteMessage,
  SiteMessageWrite,
  SiteTracking,
  SiteTrackingWrite,
} from "@kaenma/shared/website";

import { isRecord, primitiveString } from "../values";

function num(value: unknown): number {
  return Number(value ?? 0);
}

function text(value: unknown): string {
  return primitiveString(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : primitiveString(value);
}

function status(value: unknown): "draft" | "published" {
  return value === "published" ? "published" : "draft";
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function listSignupForms(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<SignupForm[]> {
  const result = await database
    .prepare(
      `SELECT f.id, f.name, f.slug, f.status, f.version, f.definition,
              f.allowed_domains, f.turnstile_enabled, f.success_message,
              f.created_at, f.updated_at,
              (SELECT COUNT(*) FROM form_submissions fs
               WHERE fs.workspace_id = f.workspace_id AND fs.form_id = f.id)
                AS submission_count
       FROM forms f
       WHERE f.workspace_id = ? AND f.status != 'archived'
       ORDER BY f.updated_at DESC LIMIT 200`,
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: text(row["id"]),
    name: text(row["name"]),
    slug: text(row["slug"]),
    status: status(row["status"]),
    version: num(row["version"]),
    definition: parseJson<SignupFormDefinition>(row["definition"], {}),
    allowedDomains: parseJson<string[]>(row["allowed_domains"], []),
    turnstileEnabled: Boolean(row["turnstile_enabled"]),
    successMessage: text(row["success_message"]),
    submissionCount: num(row["submission_count"]),
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
  }));
}

export async function createSignupForm(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: SignupFormWrite,
): Promise<{ id: string }> {
  const id = uuidv7();
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO forms
       (id, workspace_id, name, slug, status, definition, allowed_domains,
        turnstile_enabled, success_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      workspace.workspaceId,
      input.name,
      input.slug,
      input.status,
      JSON.stringify(input.definition),
      JSON.stringify(input.allowedDomains),
      input.turnstileEnabled ? 1 : 0,
      input.successMessage,
      now,
      now,
    )
    .run();
  return { id };
}

export async function updateSignupForm(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: SignupFormWrite,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE forms
       SET name = ?, slug = ?, status = ?, version = version + 1,
           definition = ?, allowed_domains = ?, turnstile_enabled = ?,
           success_message = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
    .bind(
      input.name,
      input.slug,
      input.status,
      JSON.stringify(input.definition),
      JSON.stringify(input.allowedDomains),
      input.turnstileEnabled ? 1 : 0,
      input.successMessage,
      new Date().toISOString(),
      workspace.workspaceId,
      id,
    )
    .run();
  return result.meta.changes === 1;
}

export async function archiveSignupForm(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE forms SET status = 'archived', updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
    .bind(new Date().toISOString(), workspace.workspaceId, id)
    .run();
  return result.meta.changes === 1;
}

export async function listLandingPages(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<LandingPage[]> {
  const result = await database
    .prepare(
      `SELECT lp.id, lp.name, lp.slug, lp.status, lp.current_version_id,
              lp.created_at, lp.updated_at, lpv.version, lpv.content_document
       FROM landing_pages lp
       LEFT JOIN landing_page_versions lpv
         ON lpv.workspace_id = lp.workspace_id AND lpv.id = lp.current_version_id
       WHERE lp.workspace_id = ? AND lp.status != 'archived'
       ORDER BY lp.updated_at DESC`,
    )
    .bind(workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: text(row["id"]),
    name: text(row["name"]),
    slug: text(row["slug"]),
    status: status(row["status"]),
    currentVersionId: nullableText(row["current_version_id"]),
    version: row["version"] === null || row["version"] === undefined ? null : num(row["version"]),
    contentDocument: parseJson<ContentDocument | null>(row["content_document"], null),
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
  }));
}

export async function createLandingPage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: LandingPageWrite,
): Promise<{ id: string; versionId: string }> {
  const id = uuidv7();
  const versionId = uuidv7();
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO landing_pages
         (id, workspace_id, name, slug, status, current_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, workspace.workspaceId, input.name, input.slug, input.status, versionId, now, now),
    database
      .prepare(
        `INSERT INTO landing_page_versions
         (id, workspace_id, page_id, version, content_document, published_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        versionId,
        workspace.workspaceId,
        id,
        JSON.stringify(input.content),
        input.status === "published" ? now : null,
        now,
      ),
  ]);
  return { id, versionId };
}

export type UpdatePageOutcome =
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "ok"; id: string; versionId: string };

/** Each edit appends a new version row and repoints the page at it. */
export async function updateLandingPage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: LandingPageWrite,
): Promise<UpdatePageOutcome> {
  const workspaceId = workspace.workspaceId;
  const page = await database
    .prepare(
      `SELECT id, status,
              COALESCE((SELECT MAX(version) FROM landing_page_versions
                        WHERE workspace_id = ? AND page_id = landing_pages.id), 0) AS version
       FROM landing_pages WHERE workspace_id = ? AND id = ?`,
    )
    .bind(workspaceId, workspaceId, id)
    .first<{ id: string; status: string; version: number }>();
  if (!page) return { kind: "not_found" };
  if (page.status === "archived") return { kind: "archived" };
  const versionId = uuidv7();
  const now = new Date().toISOString();
  await database.batch([
    database
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
        JSON.stringify(input.content),
        input.status === "published" ? now : null,
        now,
      ),
    database
      .prepare(
        `UPDATE landing_pages
         SET name = ?, slug = ?, status = ?, current_version_id = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .bind(input.name, input.slug, input.status, versionId, now, workspaceId, page.id),
  ]);
  return { kind: "ok", id: page.id, versionId };
}

export async function archiveLandingPage(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE landing_pages SET status = 'archived', updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
    .bind(new Date().toISOString(), workspace.workspaceId, id)
    .run();
  return result.meta.changes === 1;
}

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
    id: text(row["id"]),
    name: text(row["name"]),
    status: status(row["status"]),
    headline: text(row["headline"]),
    body: text(row["body"]),
    ctaLabel: text(row["cta_label"]),
    ctaUrl: nullableText(row["cta_url"]),
    pagePattern: text(row["page_pattern"]),
    startsAt: nullableText(row["starts_at"]),
    endsAt: nullableText(row["ends_at"]),
    impressionCount: num(row["impression_count"]),
    clickCount: num(row["click_count"]),
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
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
    allowedDomains: settings ? parseJson<string[]>(settings.allowed_domains, []) : [],
    consentMode: "required",
    workspaceSlug: organization?.slug ?? "",
    summary: {
      pageViews: num(summary?.["page_views"]),
      uniqueVisitors: num(summary?.["unique_visitors"]),
      identifiedContacts: num(summary?.["identified_contacts"]),
    },
    topPages: topPages.results.map((row) => ({
      url: text(row["url"]),
      views: num(row["views"]),
    })),
    recentEvents: recentEvents.results.map((row) => {
      const properties = parseJson<unknown>(row["properties"], {});
      return {
        visitorId: text(row["visitor_id"]),
        contactId: nullableText(row["contact_id"]),
        resourceId: text(row["resource_id"]),
        properties: isRecord(properties) ? properties : {},
        occurredAt: text(row["occurred_at"]),
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
