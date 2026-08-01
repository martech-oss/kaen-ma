import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import * as z from "zod";

import { assertSafeWebhookUrl } from "@kaenma/channels";
import { uuidv7, webhookEndpoints } from "@kaenma/database";

import { encryptCredentials } from "../crypto";
import type { AppEnvironment } from "../env";
import { parseJsonColumns, randomString, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

export function registerIntegrationRoutes(api: Hono<AppEnvironment>): void {
  api.get("/webhook-endpoints", requireRole("admin"), async (context) => {
    const rows = await context
      .get("database")
      .orm.select({
        id: webhookEndpoints.id,
        name: webhookEndpoints.name,
        url: webhookEndpoints.url,
        event_types: webhookEndpoints.eventTypes,
        enabled: webhookEndpoints.enabled,
        created_at: webhookEndpoints.createdAt,
        updated_at: webhookEndpoints.updatedAt,
      })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.workspaceId, context.get("workspace").workspaceId))
      .orderBy(desc(webhookEndpoints.updatedAt));
    return context.json({
      data: rows.map(parseJsonColumns(["event_types"])),
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
    try {
      assertSafeWebhookUrl(parsed.data.url);
    } catch {
      return apiError(
        context,
        422,
        "unsafe_webhook_url",
        "Webhook URLには公開HTTPSエンドポイントを指定してください",
      );
    }
    const secret = randomString(40);
    const encryptedSecret = await encryptCredentials(context.env.CREDENTIAL_ENCRYPTION_KEY, {
      secret,
    });
    const id = uuidv7();
    const now = new Date().toISOString();
    await context
      .get("database")
      .orm.insert(webhookEndpoints)
      .values({
        id,
        workspaceId: context.get("workspace").workspaceId,
        name: parsed.data.name,
        url: parsed.data.url,
        encryptedSecret,
        eventTypes: JSON.stringify(parsed.data.eventTypes),
        createdAt: now,
        updatedAt: now,
      });
    return context.json({ data: { id, signingSecret: secret } }, 201);
  });
}
