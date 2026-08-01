import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { ContentDocument, WorkspaceContext } from "@kaenma/shared";
import type {
  LandingPage,
  LandingPageWrite,
  SignupForm,
  SignupFormDefinition,
  SignupFormWrite,
} from "@kaenma/shared/website";

import { nullablePrimitiveString, numericValue, parseJsonValue, primitiveString } from "../values";

export * from "./message-service";
export * from "./tracking-service";

function status(value: unknown): "draft" | "published" {
  return value === "published" ? "published" : "draft";
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
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    slug: primitiveString(row["slug"]),
    status: status(row["status"]),
    version: numericValue(row["version"]),
    definition: parseJsonValue<SignupFormDefinition>(row["definition"], {}),
    allowedDomains: parseJsonValue<string[]>(row["allowed_domains"], []),
    turnstileEnabled: Boolean(row["turnstile_enabled"]),
    successMessage: primitiveString(row["success_message"]),
    submissionCount: numericValue(row["submission_count"]),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
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
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    slug: primitiveString(row["slug"]),
    status: status(row["status"]),
    currentVersionId: nullablePrimitiveString(row["current_version_id"]),
    version:
      row["version"] === null || row["version"] === undefined ? null : numericValue(row["version"]),
    contentDocument: parseJsonValue<ContentDocument | null>(row["content_document"], null),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
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
