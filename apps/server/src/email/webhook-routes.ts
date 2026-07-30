import type { Hono } from "hono";

import { ResendEmailAdapter } from "@kaenma/channels";
import { uuidv7, type DrizzleRawStatement } from "@kaenma/database";

import type { AppEnvironment } from "../env";
import { apiError } from "../middleware";

export function registerEmailWebhookRoutes(api: Hono<AppEnvironment>): void {
  api.post("/api/webhooks/resend/:workspaceId", async (context) => {
    const workspaceId = context.req.param("workspaceId");
    const webhookSecret = context.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return apiError(
        context,
        404,
        "resend_webhook_not_configured",
        "Resend Webhook設定がありません",
      );
    }
    const rawBody = await context.req.text();
    const adapter = new ResendEmailAdapter({
      apiKey: context.env.RESEND_API_KEY ?? "",
      webhookSecret,
    });
    const verification = await adapter.verifyWebhook(context.req.raw, rawBody);
    if (!verification.valid) {
      return apiError(context, 401, "invalid_webhook_signature", "Webhook署名が無効です");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiError(context, 400, "invalid_json", "JSONが不正です");
    }
    const events = adapter.normalizeEvents(body, workspaceId, verification.eventId);
    for (const event of events) {
      const status =
        event.type === "delivered"
          ? "delivered"
          : event.type === "failed" || event.type === "bounced"
            ? "failed"
            : null;
      const statements: DrizzleRawStatement[] = [
        context
          .get("database")
          .prepare(
            `INSERT OR IGNORE INTO delivery_events
           (id, workspace_id, delivery_id, provider, provider_event_id,
            provider_message_id, type, occurred_at, metadata, created_at)
           SELECT ?, ?, d.id, 'resend', ?, ?, ?, ?, ?, ?
           FROM deliveries d WHERE d.workspace_id = ? AND d.id = ?`,
          )
          .bind(
            uuidv7(),
            workspaceId,
            event.id,
            event.providerMessageId ?? null,
            event.type,
            event.occurredAt,
            JSON.stringify(event.metadata),
            new Date().toISOString(),
            workspaceId,
            event.deliveryId,
          ),
      ];
      if (status) {
        statements.push(
          context
            .get("database")
            .prepare(
              `UPDATE deliveries SET status = ?, updated_at = ?
             WHERE workspace_id = ? AND id = ?`,
            )
            .bind(status, new Date().toISOString(), workspaceId, event.deliveryId),
        );
      }
      if (["bounced", "complained", "unsubscribed"].includes(event.type)) {
        statements.push(
          context
            .get("database")
            .prepare(
              `INSERT OR IGNORE INTO suppressions
             (id, workspace_id, contact_id, email, reason, provider, created_at)
             SELECT ?, d.workspace_id, d.contact_id, d.recipient, ?, 'resend', ?
             FROM deliveries d WHERE d.workspace_id = ? AND d.id = ?`,
            )
            .bind(
              uuidv7(),
              event.type === "bounced"
                ? "bounce"
                : event.type === "complained"
                  ? "complaint"
                  : "global_unsubscribe",
              event.occurredAt,
              workspaceId,
              event.deliveryId,
            ),
        );
      }
      await context.get("database").batch(statements);
    }
    return context.json({ data: { accepted: events.length } }, 202);
  });
}
