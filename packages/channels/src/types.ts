import type {
  ChannelMessage,
  RenderedEmailMessage,
  WebhookChannelMessage,
} from "@openengage/core/messaging";
import type { DeliveryEvent } from "@openengage/core/shared";

export type { ChannelMessage, RenderedEmailMessage, WebhookChannelMessage };

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
