import { WebRepository, type OpenEngageDatabase } from "@openengage/database";
import type { WorkspaceContext } from "@openengage/orpc";
import type { LandingPage, LandingPageWrite, SignupForm, SignupFormWrite } from "@openengage/orpc";

export * from "./message-service";
export * from "./tracking-service";

function status(value: unknown): "draft" | "published" {
  return value === "published" ? "published" : "draft";
}

export async function listSignupForms(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<SignupForm[]> {
  const rows = await new WebRepository(database, workspace).listSignupForms();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: status(row.status),
    version: row.version,
    definition: row.definition,
    allowedDomains: row.allowedDomains,
    turnstileEnabled: row.turnstileEnabled,
    successMessage: row.successMessage,
    submissionCount: row.submissionCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function createSignupForm(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: SignupFormWrite,
): Promise<{ id: string }> {
  return new WebRepository(database, workspace).createSignupForm(input);
}

export async function updateSignupForm(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: SignupFormWrite,
): Promise<boolean> {
  return new WebRepository(database, workspace).updateSignupForm(id, input);
}

export async function archiveSignupForm(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new WebRepository(database, workspace).archiveSignupForm(id);
}

export async function listLandingPages(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<LandingPage[]> {
  const rows = await new WebRepository(database, workspace).listLandingPages();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: status(row.status),
    currentVersionId: row.currentVersionId,
    version: row.version,
    contentDocument: row.contentDocument,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function createLandingPage(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: LandingPageWrite,
): Promise<{ id: string; versionId: string }> {
  return new WebRepository(database, workspace).createLandingPage(input);
}

export type UpdatePageOutcome =
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "ok"; id: string; versionId: string };

/** Each edit appends a new version row and repoints the page at it. */
export async function updateLandingPage(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: LandingPageWrite,
): Promise<UpdatePageOutcome> {
  return new WebRepository(database, workspace).updateLandingPage(id, input);
}

export async function archiveLandingPage(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new WebRepository(database, workspace).archiveLandingPage(id);
}
