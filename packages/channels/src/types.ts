import type { DeliveryEvent, MessagePurpose } from "@openengage/orpc";

export interface RenderedEmailMessage {
  kind: "email";
  idempotencyKey: string;
  workspaceId?: string;
  deliveryId?: string;
  purpose: MessagePurpose;
  to: string;
  from: { email: string; name?: string };
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  metadata?: Record<string, string>;
}

export interface WebhookChannelMessage {
  kind: "webhook";
  idempotencyKey: string;
  workspaceId: string;
  deliveryId: string;
  payload: Record<string, unknown>;
}

export type ChannelMessage = RenderedEmailMessage | WebhookChannelMessage;

export interface ChannelSendResult {
  providerMessageId: string;
  acceptedAt: string;
}

export interface ChannelHealth {
  healthy: boolean;
  detail: string;
}

export interface WebhookVerification {
  valid: boolean;
  eventId?: string;
}

export interface ChannelAdapter {
  readonly provider: "cloudflare" | "webhook";
  send(message: ChannelMessage): Promise<ChannelSendResult>;
  healthCheck(): Promise<ChannelHealth>;
}

export interface WebhookChannelAdapter extends ChannelAdapter {
  verifyWebhook(request: Request, rawBody: string): Promise<WebhookVerification>;
  normalizeEvents(payload: unknown, eventId?: string): DeliveryEvent[];
}
