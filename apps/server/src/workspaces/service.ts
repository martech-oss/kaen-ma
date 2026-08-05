import { type OpenEngageDatabase, organization } from "@openengage/database";
import type { Workspace } from "@openengage/orpc";
import type { WorkspaceContext } from "@openengage/orpc";
import { eq } from "drizzle-orm";

export async function getWorkspace(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<Workspace> {
  const row = await database.orm.query.organization.findFirst({
    columns: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      timezone: true,
      createdAt: true,
    },
    where: eq(organization.id, workspace.workspaceId),
  });

  if (!row) {
    throw new Error("Workspace organization could not be loaded");
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    timezone: row.timezone,
    created_at: row.createdAt.getTime(),
    role: workspace.role,
  };
}
