import { and, count, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import * as z from "zod";

import { projectItems, projects, uuidv7 } from "@kaenma/database";

import type { AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

export function registerProjectRoutes(api: Hono<AppEnvironment>): void {
  api.get("/projects", async (context) => {
    const rows = await context
      .get("database")
      .orm.select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        color: projects.color,
        created_at: projects.createdAt,
        updated_at: projects.updatedAt,
        item_count: count(projectItems.resourceId),
      })
      .from(projects)
      .leftJoin(
        projectItems,
        and(
          eq(projectItems.workspaceId, projects.workspaceId),
          eq(projectItems.projectId, projects.id),
        ),
      )
      .where(eq(projects.workspaceId, context.get("workspace").workspaceId))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));
    return context.json({ data: rows });
  });

  api.post("/projects", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        description: z.string().max(2_000).default(""),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#7c3aed"),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const id = uuidv7();
    const now = new Date().toISOString();
    await context
      .get("database")
      .orm.insert(projects)
      .values({
        id,
        workspaceId: context.get("workspace").workspaceId,
        name: parsed.data.name,
        description: parsed.data.description,
        color: parsed.data.color,
        createdAt: now,
        updatedAt: now,
      });
    return context.json({ data: { id } }, 201);
  });

  api.post("/projects/:id/items", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        resourceType: z.enum(["campaign", "email", "form", "page", "segment"]),
        resourceId: z.string().min(1),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const project = await context.get("database").orm.query.projects.findFirst({
      columns: { id: true },
      where: and(eq(projects.workspaceId, workspaceId), eq(projects.id, context.req.param("id"))),
    });
    if (!project) {
      return apiError(context, 404, "project_not_found", "Projectが見つかりません");
    }
    const result = await context
      .get("database")
      .orm.insert(projectItems)
      .values({
        workspaceId,
        projectId: project.id,
        resourceType: parsed.data.resourceType,
        resourceId: parsed.data.resourceId,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    return result.meta.changes === 1
      ? context.json({ data: { added: true } }, 201)
      : context.json({ data: { added: false } });
  });
}
