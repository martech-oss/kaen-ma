import { ResendEmailAdapter } from "@openengage/channels";
import { MessagingWorkerRepository } from "@openengage/database";
import type { Hono } from "hono";

import { apiError } from "../auth/access";
import { recordContactEvent } from "../contacts/event-service";
import type { AppEnvironment } from "../env";

export function registerEmailWebhookRoutes(api: Hono<AppEnvironment>): void {
  api.post("/api/webhooks/resend", async (context) => {
    const database = context.get("database");
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
      apiKey: context.env.RESEND_SEND_API_KEY ?? "",
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
    const repository = new MessagingWorkerRepository(database);
    const events = adapter.normalizeEvents(body, verification.eventId);
    for (const event of events) {
      const workspaceId = event.workspaceId;
      const status =
        event.type === "delivered"
          ? "delivered"
          : event.type === "failed" || event.type === "bounced"
            ? "failed"
            : null;
      const suppressionReason = ["bounced", "complained", "unsubscribed"].includes(event.type)
        ? event.type === "bounced"
          ? "bounce"
          : event.type === "complained"
            ? "complaint"
            : "global_unsubscribe"
        : null;
      const inserted = await repository.applyResendDeliveryEvent({
        workspaceId,
        deliveryId: event.deliveryId,
        providerEventId: event.id,
        providerMessageId: event.providerMessageId ?? null,
        type: event.type,
        occurredAt: event.occurredAt,
        metadata: JSON.stringify(event.metadata),
        status,
        suppressionReason,
      });
      const contactEventType =
        event.type === "opened"
          ? "email_opened"
          : event.type === "clicked"
            ? "email_clicked"
            : event.type === "replied"
              ? "email_replied"
              : null;
      if (inserted && contactEventType) {
        const contactId = await repository.findDeliveryContactId(workspaceId, event.deliveryId);
        if (contactId) {
          await recordContactEvent(database, {
            id: `resend:${event.id}`,
            workspaceId,
            contactId,
            type: contactEventType,
            resourceType: "delivery",
            resourceId: event.deliveryId,
            properties: event.metadata,
            occurredAt: event.occurredAt,
          });
        }
      }
    }
    return context.json({ data: { accepted: events.length } }, 202);
  });
}
