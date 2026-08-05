import type { DeliveryEvent } from "@openengage/orpc";
import { Resend, type ErrorResponse } from "resend";

import { PermanentChannelError, TransientChannelError } from "./errors";
import { isStaleTimestamp, verifySvixSignature } from "./signatures";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelMessage,
  ChannelSendResult,
  HostedEmailMessage,
  WebhookVerification,
} from "./types";
import { isRecord } from "./values";

export interface ResendAdapterOptions {
  apiKey: string;
  webhookSecret?: string;
  client?: Resend;
}

export interface ResendTemplateVariable {
  key: string;
  type: "string" | "number";
  fallbackValue: string | number | null;
}

export interface ResendHostedTemplate {
  id: string;
  alias: string | null;
  name: string;
  subject: string | null;
  status: "draft" | "published";
  currentVersionId: string;
  hasUnpublishedVersions: boolean;
  publishedAt: string | null;
  updatedAt: string;
  variables: ResendTemplateVariable[];
}

export interface ResendTemplateAdapterOptions {
  apiKey: string;
  client?: Resend;
}

export class ResendEmailAdapter implements ChannelAdapter {
  public readonly provider = "resend" as const;
  private readonly client: Resend;

  public constructor(private readonly options: ResendAdapterOptions) {
    this.client = options.client ?? new Resend(options.apiKey, { userAgent: "openengage/0.1.0" });
  }

  public async send(message: ChannelMessage): Promise<ChannelSendResult> {
    if (message.kind !== "email") {
      throw new PermanentChannelError("Resend adapter only accepts email messages");
    }
    const unsubscribeUrl = message.metadata?.["unsubscribeUrl"];
    const tags =
      message.deliveryId && message.workspaceId
        ? [
            { name: "openengage_delivery_id", value: message.deliveryId },
            { name: "openengage_workspace_id", value: message.workspaceId },
          ]
        : undefined;
    const result = await this.client.emails.send(
      {
        from: formatAddress(message.from),
        to: [message.to],
        template: message.template,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(unsubscribeUrl && message.purpose === "marketing"
          ? {
              headers: {
                "List-Unsubscribe": `<${unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
        ...(tags ? { tags } : {}),
      },
      { idempotencyKey: message.idempotencyKey.slice(0, 256) },
    );
    if (result.error) throwResendError(result.error);
    if (!result.data?.id) {
      throw new TransientChannelError("Resend accepted the request without a message ID");
    }
    return {
      providerMessageId: result.data.id,
      acceptedAt: new Date().toISOString(),
    };
  }

  public async verifyWebhook(request: Request, rawBody: string): Promise<WebhookVerification> {
    if (!this.options.webhookSecret) return { valid: false };
    const eventId = request.headers.get("svix-id");
    const timestamp = request.headers.get("svix-timestamp");
    const signature = request.headers.get("svix-signature");
    if (!eventId || !signature || !timestamp || isStaleTimestamp(timestamp)) {
      return { valid: false };
    }
    return {
      valid: await verifySvixSignature(
        this.options.webhookSecret,
        eventId,
        timestamp,
        rawBody,
        signature,
      ),
      eventId,
    };
  }

  public normalizeEvents(payload: unknown, eventId?: string): DeliveryEvent[] {
    if (!isRecord(payload) || !isRecord(payload["data"])) return [];
    const data = payload["data"];
    const tags = isRecord(data["tags"]) ? data["tags"] : {};
    const deliveryId = tags["openengage_delivery_id"];
    const workspaceId = tags["openengage_workspace_id"];
    const messageId = data["email_id"];
    const eventType = payload["type"];
    if (
      typeof deliveryId !== "string" ||
      typeof workspaceId !== "string" ||
      typeof messageId !== "string" ||
      typeof eventType !== "string"
    ) {
      return [];
    }
    const type = normalizeResendType(eventType);
    if (!type) return [];
    const occurredAt =
      typeof payload["created_at"] === "string" ? payload["created_at"] : new Date().toISOString();
    return [
      {
        id: eventId ?? `${messageId}:${eventType}:${occurredAt}`,
        workspaceId,
        deliveryId,
        provider: "resend",
        providerMessageId: messageId,
        type,
        occurredAt,
        metadata: payload,
      },
    ];
  }

  public async healthCheck(): Promise<ChannelHealth> {
    return {
      healthy: this.options.apiKey.length > 0,
      detail: "Resend API key is configured",
    };
  }
}

export class ResendTemplateAdapter {
  private readonly client: Resend;

  public constructor(options: ResendTemplateAdapterOptions) {
    this.client = options.client ?? new Resend(options.apiKey, { userAgent: "openengage/0.1.0" });
  }

  public async get(identifier: string): Promise<ResendHostedTemplate> {
    const result = await this.client.templates.get(identifier);
    if (result.error) throwResendError(result.error);
    if (!result.data) throw new TransientChannelError("Resend returned an empty template");
    return {
      id: result.data.id,
      alias: result.data.alias,
      name: result.data.name,
      subject: result.data.subject,
      status: result.data.status,
      currentVersionId: result.data.current_version_id,
      hasUnpublishedVersions: result.data.has_unpublished_versions,
      publishedAt: result.data.published_at,
      updatedAt: result.data.updated_at,
      variables: (result.data.variables ?? []).map((variable) => ({
        key: variable.key,
        type: variable.type,
        fallbackValue: variable.fallback_value,
      })),
    };
  }
}

function formatAddress(from: HostedEmailMessage["from"]): string {
  return from.name ? `${from.name.replaceAll(/[<>"]/g, "")} <${from.email}>` : from.email;
}

function throwResendError(error: ErrorResponse): never {
  const detail = `${error.name}: ${error.message}`;
  if (
    error.statusCode !== null &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    error.statusCode !== 408 &&
    error.statusCode !== 429
  ) {
    throw new PermanentChannelError(`Resend rejected the request: ${detail}`);
  }
  throw new TransientChannelError(`Resend is temporarily unavailable: ${detail}`);
}

function normalizeResendType(value: string): DeliveryEvent["type"] | null {
  if (value === "email.sent") return "accepted";
  if (value === "email.delivered") return "delivered";
  if (value === "email.opened") return "opened";
  if (value === "email.clicked") return "clicked";
  if (value === "email.bounced") return "bounced";
  if (value === "email.complained") return "complained";
  if (value === "email.failed" || value === "email.suppressed") return "failed";
  return null;
}
