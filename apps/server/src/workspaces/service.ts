import { eq } from "drizzle-orm";

import { type KaenmaDatabase, organization } from "@kaenma/database";
import type { Workspace } from "@kaenma/orpc";
import type { WorkspaceContext } from "@kaenma/shared";

export async function getWorkspace(
  database: KaenmaDatabase,
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
