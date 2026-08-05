import {
  PermanentChannelError,
  RecipientSuppressedChannelError,
  TransientChannelError,
  type ChannelMessage,
} from "@openengage/channels";
import { describe, expect, it, vi } from "vitest";

import { CloudflareEmailAdapter } from "./cloudflare-email";

const message: ChannelMessage = {
  kind: "email",
  idempotencyKey: "delivery:one",
  workspaceId: "workspace",
  deliveryId: "delivery",
  purpose: "transactional",
  to: "person@example.com",
  from: { email: "notifications@example.com", name: "OpenEngage" },
  replyTo: "reply@example.com",
  subject: "Welcome\nto OpenEngage",
  html: "<h1>Welcome</h1>",
  text: "Welcome",
};

describe("CloudflareEmailAdapter", () => {
  it("sends rendered HTML, text, and a sanitized subject", async () => {
    const send = vi
      .fn<(builder: EmailMessageBuilder) => Promise<EmailSendResult>>()
      .mockResolvedValue({ messageId: "cf-message-1" });
    const adapter = new CloudflareEmailAdapter({ send } as unknown as SendEmail);

    await expect(adapter.send(message)).resolves.toMatchObject({
      providerMessageId: "cf-message-1",
    });
    expect(send).toHaveBeenCalledWith({
      to: "person@example.com",
      from: { email: "notifications@example.com", name: "OpenEngage" },
      replyTo: "reply@example.com",
      subject: "Welcome to OpenEngage",
      html: "<h1>Welcome</h1>",
      text: "Welcome",
    });
  });

  it("permanently rejects marketing messages before calling the binding", async () => {
    const send = vi.fn<(builder: EmailMessageBuilder) => Promise<EmailSendResult>>();
    const adapter = new CloudflareEmailAdapter({ send } as unknown as SendEmail);

    await expect(adapter.send({ ...message, purpose: "marketing" })).rejects.toBeInstanceOf(
      PermanentChannelError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects rendered content above the 5 MiB application limit", async () => {
    const send = vi.fn<(builder: EmailMessageBuilder) => Promise<EmailSendResult>>();
    const adapter = new CloudflareEmailAdapter({ send } as unknown as SendEmail);

    await expect(
      adapter.send({ ...message, html: "x".repeat(5 * 1024 * 1024) }),
    ).rejects.toBeInstanceOf(PermanentChannelError);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    "E_RATE_LIMIT_EXCEEDED",
    "E_DAILY_LIMIT_EXCEEDED",
    "E_DELIVERY_FAILED",
    "E_INTERNAL_SERVER_ERROR",
  ])("classifies %s as retryable", async (code) => {
    const send = vi
      .fn<(builder: EmailMessageBuilder) => Promise<EmailSendResult>>()
      .mockRejectedValue(Object.assign(new Error("temporary"), { code }));
    const adapter = new CloudflareEmailAdapter({ send } as unknown as SendEmail);
    await expect(adapter.send(message)).rejects.toBeInstanceOf(TransientChannelError);
  });

  it("classifies recipient suppression separately", async () => {
    const send = vi
      .fn<(builder: EmailMessageBuilder) => Promise<EmailSendResult>>()
      .mockRejectedValue(
        Object.assign(new Error("recipient is suppressed"), { code: "E_RECIPIENT_SUPPRESSED" }),
      );
    const adapter = new CloudflareEmailAdapter({ send } as unknown as SendEmail);
    await expect(adapter.send(message)).rejects.toBeInstanceOf(RecipientSuppressedChannelError);
  });

  it("treats validation failures as permanent", async () => {
    const send = vi
      .fn<(builder: EmailMessageBuilder) => Promise<EmailSendResult>>()
      .mockRejectedValue(Object.assign(new Error("invalid"), { code: "E_VALIDATION_ERROR" }));
    const adapter = new CloudflareEmailAdapter({ send } as unknown as SendEmail);
    await expect(adapter.send(message)).rejects.toBeInstanceOf(PermanentChannelError);
  });
});
