import type { Hono } from "hono";
import { z } from "zod";

import { uuidv7 } from "@kaenma/database";

import { encryptCredentials } from "../crypto";
import type { AppEnvironment } from "../env";
import { parseJsonColumns, randomString, safeJson, validationError } from "../http/helpers";
import { requireRole } from "../middleware";

export function registerIntegrationRoutes(api: Hono<AppEnvironment>): void {
  api.get("/webhook-endpoints", requireRole("admin"), async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, name, url, event_types, enabled, created_at, updated_at
         FROM webhook_endpoints WHERE workspace_id = ? ORDER BY updated_at DESC`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({
      data: result.results.map(parseJsonColumns(["event_types"])),
    });
  });

  api.post("/webhook-endpoints", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        url: z.url().startsWith("https://"),
        eventTypes: z.array(z.string().max(120)).max(100).default([]),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const secret = randomString(40);
    const encryptedSecret = await encryptCredentials(context.env.CREDENTIAL_ENCRYPTION_KEY, {
      secret,
    });
    const id = uuidv7();
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO webhook_endpoints
         (id, workspace_id, name, url, encrypted_secret, event_types, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.url,
        encryptedSecret,
        JSON.stringify(parsed.data.eventTypes),
        now,
        now,
      )
      .run();
    return context.json({ data: { id, signingSecret: secret } }, 201);
  });
}
