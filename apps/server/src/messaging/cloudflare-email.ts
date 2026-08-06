import {
  PermanentChannelError,
  RecipientSuppressedChannelError,
  TransientChannelError,
  type ChannelAdapter,
  type ChannelHealth,
  type ChannelMessage,
  type ChannelSendResult,
} from "../channels";

const maximumMessageBytes = 5 * 1024 * 1024;
const transientCodes = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_DELIVERY_FAILED",
  "E_INTERNAL_SERVER_ERROR",
]);

export class CloudflareEmailAdapter implements ChannelAdapter {
  public readonly provider = "cloudflare" as const;

  public constructor(private readonly email: SendEmail) {}

  public async send(message: ChannelMessage): Promise<ChannelSendResult> {
    if (message.kind !== "email") {
      throw new PermanentChannelError("Cloudflare Email adapter only accepts email messages");
    }
    if (message.purpose !== "transactional") {
      throw new PermanentChannelError("Cloudflare Email Service only accepts transactional email");
    }
    const subject = message.subject.replaceAll(/[\r\n]+/g, " ").trim();
    if (!subject || subject.length > 998) {
      throw new PermanentChannelError("Email subject must contain between 1 and 998 characters");
    }
    const bytes = new TextEncoder().encode(
      `${subject}\n${message.html}\n${message.text}`,
    ).byteLength;
    if (bytes > maximumMessageBytes) {
      throw new PermanentChannelError("Email content exceeds Cloudflare's 5 MiB limit");
    }

    try {
      const result = await this.email.send({
        to: message.to,
        from: message.from.name
          ? { email: message.from.email, name: message.from.name }
          : message.from.email,
        subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });
      if (!result.messageId) {
        throw new TransientChannelError("Cloudflare accepted the email without a message ID");
      }
      return { providerMessageId: result.messageId, acceptedAt: new Date().toISOString() };
    } catch (error) {
      if (
        error instanceof PermanentChannelError ||
        error instanceof TransientChannelError ||
        error instanceof RecipientSuppressedChannelError
      ) {
        throw error;
      }
      throwCloudflareEmailError(error);
    }
  }

  public async healthCheck(): Promise<ChannelHealth> {
    return { healthy: true, detail: "Cloudflare Email Service binding is configured" };
  }
}

function throwCloudflareEmailError(error: unknown): never {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "E_UNKNOWN";
  const message =
    typeof candidate?.message === "string" ? candidate.message : "Unknown Cloudflare Email error";
  if (code === "E_RECIPIENT_SUPPRESSED") {
    throw new RecipientSuppressedChannelError(`${code}: ${message}`);
  }
  if (transientCodes.has(code)) {
    throw new TransientChannelError(`${code}: ${message}`);
  }
  throw new PermanentChannelError(`${code}: ${message}`);
}
