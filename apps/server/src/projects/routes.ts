import type { Hono } from "hono";
import { z } from "zod";

import { uuidv7 } from "@kaenma/database";

import type { AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

export function registerProjectRoutes(api: Hono<AppEnvironment>): void {
  api.get("/projects", async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `SELECT p.id, p.name, p.description, p.color, p.created_at, p.updated_at,
                COUNT(pi.resource_id) AS item_count
         FROM projects p LEFT JOIN project_items pi
           ON pi.workspace_id = p.workspace_id AND pi.project_id = p.id
         WHERE p.workspace_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
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
      .prepare(
        `INSERT INTO projects
         (id, workspace_id, name, description, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.description,
        parsed.data.color,
        now,
        now,
      )
      .run();
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
    const result = await context
      .get("database")
      .prepare(
        `INSERT OR IGNORE INTO project_items
         (workspace_id, project_id, resource_type, resource_id, created_at)
         SELECT ?, p.id, ?, ?, ? FROM projects p
         WHERE p.workspace_id = ? AND p.id = ?`,
      )
      .bind(
        context.get("workspace").workspaceId,
        parsed.data.resourceType,
        parsed.data.resourceId,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { added: true } }, 201)
      : apiError(context, 404, "project_not_found", "Projectが見つかりません");
  });
}
