import type { DeliveryEvent, MessagePurpose } from "@kaenma/orpc";

export interface HostedEmailMessage {
  kind: "email";
  idempotencyKey: string;
  workspaceId?: string;
  deliveryId?: string;
  purpose: MessagePurpose;
  to: string;
  from: { email: string; name?: string };
  replyTo?: string;
  template: {
    id: string;
    variables?: Record<string, string | number>;
  };
  metadata?: Record<string, string>;
}

export interface WebhookChannelMessage {
  kind: "webhook";
  idempotencyKey: string;
  workspaceId: string;
  deliveryId: string;
  payload: Record<string, unknown>;
}

export type ChannelMessage = HostedEmailMessage | WebhookChannelMessage;

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
  readonly provider: "resend" | "webhook";
  send(message: ChannelMessage): Promise<ChannelSendResult>;
  verifyWebhook(request: Request, rawBody: string): Promise<WebhookVerification>;
  normalizeEvents(payload: unknown, eventId?: string): DeliveryEvent[];
  healthCheck(): Promise<ChannelHealth>;
}
