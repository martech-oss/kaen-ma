import type { DeliveryEvent, MessagePurpose } from "@kaenma/shared";

export interface ChannelMessage {
  idempotencyKey: string;
  workspaceId: string;
  deliveryId: string;
  purpose: MessagePurpose;
  to: string;
  from: { email: string; name?: string };
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  metadata?: Record<string, string>;
}

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
  readonly provider: "cloudflare" | "resend" | "webhook";
  send(message: ChannelMessage): Promise<ChannelSendResult>;
  verifyWebhook(request: Request, rawBody: string): Promise<WebhookVerification>;
  normalizeEvents(payload: unknown, workspaceId: string, eventId?: string): DeliveryEvent[];
  healthCheck(): Promise<ChannelHealth>;
}

interface CloudflareEmailBinding {
  send(message: {
    from: string | { email: string; name: string };
    to: string;
    subject: string;
    replyTo?: string;
    headers?: Record<string, string>;
    text: string;
    html: string;
  }): Promise<{ messageId: string }>;
}

export class CloudflareEmailAdapter implements ChannelAdapter {
  public readonly provider = "cloudflare" as const;

  public constructor(private readonly binding: CloudflareEmailBinding) {}

  public async send(message: ChannelMessage): Promise<ChannelSendResult> {
    if (message.purpose !== "transactional") {
      throw new PermanentChannelError(
        "Cloudflare Email Service cannot be used for marketing messages",
      );
    }
    const result = await this.binding.send({
      from: message.from.name
        ? { email: message.from.email, name: message.from.name }
        : message.from.email,
      to: message.to,
      subject: message.subject,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      headers: {
        "X-Kaenma-Delivery-ID": message.deliveryId,
        "X-Kaenma-Idempotency-Key": message.idempotencyKey,
      },
      text: message.text,
      html: message.html,
    });
    return { providerMessageId: result.messageId, acceptedAt: new Date().toISOString() };
  }

  public async verifyWebhook(): Promise<WebhookVerification> {
    return { valid: false };
  }

  public normalizeEvents(): DeliveryEvent[] {
    return [];
  }

  public async healthCheck(): Promise<ChannelHealth> {
    return { healthy: true, detail: "Cloudflare Email binding is configured" };
  }
}

export interface ResendAdapterOptions {
  apiKey: string;
  webhookSecret?: string;
  fetcher?: typeof fetch;
}

export class ResendEmailAdapter implements ChannelAdapter {
  public readonly provider = "resend" as const;
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: ResendAdapterOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  public async send(message: ChannelMessage): Promise<ChannelSendResult> {
    if (message.purpose !== "marketing") {
      throw new PermanentChannelError("Resend adapter only accepts marketing messages");
    }
    const unsubscribeUrl = message.metadata?.["unsubscribeUrl"];
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: formatAddress(message.from),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(unsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
        tags: [
          { name: "kaenma_delivery_id", value: message.deliveryId },
          { name: "kaenma_workspace_id", value: message.workspaceId },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new PermanentChannelError(`Resend rejected the message: ${detail}`);
      }
      throw new TransientChannelError(`Resend is temporarily unavailable: ${detail}`);
    }
    const payload = (await response.json()) as { id?: string };
    if (!payload.id) {
      throw new TransientChannelError("Resend accepted the request without a message ID");
    }
    return {
      providerMessageId: payload.id,
      acceptedAt: new Date().toISOString(),
    };
  }

  public async verifyWebhook(request: Request, rawBody: string): Promise<WebhookVerification> {
    if (!this.options.webhookSecret) return { valid: false };
    const eventId = request.headers.get("svix-id");
    const timestamp = request.headers.get("svix-timestamp");
    const signature = request.headers.get("svix-signature");
    if (!eventId || !signature || !timestamp || isStale(timestamp)) {
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

  public normalizeEvents(payload: unknown, workspaceId: string, eventId?: string): DeliveryEvent[] {
    if (!isRecord(payload) || !isRecord(payload["data"])) return [];
    const data = payload["data"];
    const tags = isRecord(data["tags"]) ? data["tags"] : {};
    const deliveryId = tags["kaenma_delivery_id"];
    const messageId = data["email_id"];
    const eventType = payload["type"];
    if (
      typeof deliveryId !== "string" ||
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

export interface WebhookAdapterOptions {
  url: string;
  secret: string;
  fetcher?: typeof fetch;
}

export class OutboundWebhookAdapter implements ChannelAdapter {
  public readonly provider = "webhook" as const;
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: WebhookAdapterOptions) {
    assertSafeWebhookUrl(options.url);
    this.fetcher = options.fetcher ?? fetch;
  }

  public async send(message: ChannelMessage): Promise<ChannelSendResult> {
    const eventId = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      id: eventId,
      type: "message.requested",
      occurredAt: new Date().toISOString(),
      data: message,
    });
    const signature = await hmacHex(this.options.secret, `${timestamp}.${body}`);
    const response = await this.fetcher(this.options.url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Kaenma-Event-Id": eventId,
        "Kaenma-Timestamp": timestamp,
        "Kaenma-Signature": `v1=${signature}`,
        "Idempotency-Key": message.idempotencyKey,
      },
      body,
    });
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429
    ) {
      throw new PermanentChannelError(`Webhook rejected the event with ${response.status}`);
    }
    if (!response.ok) {
      throw new TransientChannelError(`Webhook failed with ${response.status}`);
    }
    return { providerMessageId: eventId, acceptedAt: new Date().toISOString() };
  }

  public async verifyWebhook(request: Request, rawBody: string): Promise<WebhookVerification> {
    const eventId = request.headers.get("kaenma-event-id");
    const timestamp = request.headers.get("kaenma-timestamp");
    const signature = request.headers.get("kaenma-signature")?.replace(/^v1=/, "");
    if (!eventId || !timestamp || !signature || isStale(timestamp)) return { valid: false };
    const expected = await hmacHex(this.options.secret, `${timestamp}.${rawBody}`);
    return { valid: timingSafeEqual(signature, expected), eventId };
  }

  public normalizeEvents(payload: unknown, workspaceId: string): DeliveryEvent[] {
    if (!isRecord(payload) || !isRecord(payload["data"])) return [];
    const data = payload["data"];
    if (
      typeof payload["id"] !== "string" ||
      typeof payload["type"] !== "string" ||
      typeof data["deliveryId"] !== "string"
    ) {
      return [];
    }
    const normalized = normalizeDeliveryType(payload["type"]);
    if (!normalized) return [];
    return [
      {
        id: payload["id"],
        workspaceId,
        deliveryId: data["deliveryId"],
        provider: "webhook",
        type: normalized,
        occurredAt:
          typeof payload["occurredAt"] === "string"
            ? payload["occurredAt"]
            : new Date().toISOString(),
        metadata: payload,
      },
    ];
  }

  public async healthCheck(): Promise<ChannelHealth> {
    return { healthy: true, detail: "Webhook URL and signing secret are configured" };
  }
}

export class PermanentChannelError extends Error {
  public override readonly name = "PermanentChannelError";
}

export class TransientChannelError extends Error {
  public override readonly name = "TransientChannelError";
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

export function assertSafeWebhookUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Webhook URL must be HTTPS and cannot contain credentials");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "0.0.0.0" ||
    hostname === "169.254.169.254" ||
    isPrivateIp(hostname)
  ) {
    throw new Error("Webhook URL cannot target a private or link-local address");
  }
}

function formatAddress(from: ChannelMessage["from"]): string {
  return from.name ? `${from.name.replaceAll(/[<>"]/g, "")} <${from.email}>` : from.email;
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

function normalizeDeliveryType(value: string): DeliveryEvent["type"] | null {
  const candidate = value.replace(/^message\./, "");
  const allowed: DeliveryEvent["type"][] = [
    "accepted",
    "delivered",
    "opened",
    "clicked",
    "bounced",
    "complained",
    "unsubscribed",
    "replied",
    "failed",
  ];
  return allowed.includes(candidate as DeliveryEvent["type"])
    ? (candidate as DeliveryEvent["type"])
    : null;
}

function isStale(timestamp: string): boolean {
  const seconds = Number(timestamp);
  return !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300;
}

async function verifySvixSignature(
  secret: string,
  eventId: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let secretBytes: Uint8Array<ArrayBuffer>;
  try {
    secretBytes = decodeBase64(encodedSecret);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${eventId}.${timestamp}.${rawBody}`),
  );
  const expected = encodeBase64(new Uint8Array(signature));
  return signatureHeader.split(" ").some((candidate) => {
    const [version, value] = candidate.split(",", 2);
    return version === "v1" && typeof value === "string" && timingSafeEqual(value, expected);
  });
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrivateIp(hostname: string): boolean {
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part > 255)) return true;
    const [first = 0, second = 0] = octets;
    return (
      first === 10 ||
      first === 127 ||
      first === 0 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return (
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe8") ||
    hostname.startsWith("fe9") ||
    hostname.startsWith("fea") ||
    hostname.startsWith("feb")
  );
}
