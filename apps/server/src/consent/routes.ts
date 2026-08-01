import { asc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import * as z from "zod";

import { subscriptionTopics, uuidv7 } from "@kaenma/database";

import type { AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { requireRole } from "../middleware";

export function registerConsentRoutes(api: Hono<AppEnvironment>): void {
  api.get("/subscription-topics", async (context) => {
    const rows = await context
      .get("database")
      .orm.select({
        id: subscriptionTopics.id,
        name: subscriptionTopics.name,
        slug: subscriptionTopics.slug,
        description: subscriptionTopics.description,
        is_default: subscriptionTopics.isDefault,
        created_at: subscriptionTopics.createdAt,
        updated_at: subscriptionTopics.updatedAt,
      })
      .from(subscriptionTopics)
      .where(eq(subscriptionTopics.workspaceId, context.get("workspace").workspaceId))
      .orderBy(asc(subscriptionTopics.name));
    return context.json({ data: rows });
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
      .orm.insert(subscriptionTopics)
      .values({
        id,
        workspaceId: context.get("workspace").workspaceId,
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description,
        isDefault: parsed.data.isDefault ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
    return context.json({ data: { id } }, 201);
  });
}
