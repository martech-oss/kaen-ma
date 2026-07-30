import type { Hono } from "hono";
import { z } from "zod";

import { uuidv7 } from "@kaenma/database";

import type { AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { requireRole } from "../middleware";

export function registerConsentRoutes(api: Hono<AppEnvironment>): void {
  api.get("/subscription-topics", async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, name, slug, description, is_default, created_at, updated_at
         FROM subscription_topics WHERE workspace_id = ? ORDER BY name`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/subscription-topics", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().max(2_000).default(""),
        isDefault: z.boolean().default(false),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const id = uuidv7();
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO subscription_topics
         (id, workspace_id, name, slug, description, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.slug,
        parsed.data.description,
        parsed.data.isDefault ? 1 : 0,
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });
}
