import type { Workspace } from "@kaenma/api-contract";
import type { KaenmaDatabase } from "@kaenma/db";
import type { WorkspaceContext } from "@kaenma/shared";

type WorkspaceRow = Omit<Workspace, "role">;

export async function getWorkspace(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<Workspace> {
  const organization = await database
    .prepare(
      "SELECT id, name, slug, logo, timezone, created_at FROM organization WHERE id = ?",
    )
    .bind(workspace.workspaceId)
    .first<WorkspaceRow>();

  if (!organization) {
    throw new Error("Workspace organization could not be loaded");
  }

  return { ...organization, role: workspace.role };
}
