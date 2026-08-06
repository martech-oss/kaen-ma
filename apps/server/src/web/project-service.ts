import { and, count, desc, eq } from "drizzle-orm";

import type { ProjectRow } from "@openengage/core/projects";
import { projectItems, projects, uuidv7, type OpenEngageDatabase } from "@openengage/database";

export async function listProjects(
  database: OpenEngageDatabase,
  workspaceId: string,
): Promise<ProjectRow[]> {
  const rows = await database.orm
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      color: projects.color,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      itemCount: count(projectItems.resourceId),
    })
    .from(projects)
    .leftJoin(
      projectItems,
      and(
        eq(projectItems.workspaceId, projects.workspaceId),
        eq(projectItems.projectId, projects.id),
      ),
    )
    .where(eq(projects.workspaceId, workspaceId))
    .groupBy(projects.id)
    .orderBy(desc(projects.updatedAt));
  return rows;
}

export async function createProject(
  database: OpenEngageDatabase,
  workspaceId: string,
  input: { name: string; description: string; color: string },
): Promise<{ id: string }> {
  const id = uuidv7();
  const now = new Date().toISOString();
  await database.orm.insert(projects).values({
    id,
    workspaceId,
    name: input.name,
    description: input.description,
    color: input.color,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export type ProjectItemOutcome = { kind: "project_not_found" } | { kind: "done"; added: boolean };

export async function addProjectItem(
  database: OpenEngageDatabase,
  workspaceId: string,
  input: { projectId: string; resourceType: string; resourceId: string },
): Promise<ProjectItemOutcome> {
  const project = await database.orm.query.projects.findFirst({
    columns: { id: true },
    where: and(eq(projects.workspaceId, workspaceId), eq(projects.id, input.projectId)),
  });
  if (!project) return { kind: "project_not_found" };
  const result = await database.orm
    .insert(projectItems)
    .values({
      workspaceId,
      projectId: project.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
  return { kind: "done", added: result.meta.changes === 1 };
}
