import { describe, expect, it } from "vitest";
import {
  CloudflareEmailAdapter,
  OutboundWebhookAdapter,
  PermanentChannelError,
  assertSafeWebhookUrl,
} from "./index";

describe("channel policy", () => {
  it("prevents marketing messages from using Cloudflare Email Service", async () => {
    const adapter = new CloudflareEmailAdapter({
      send: async () => ({ messageId: "unused" }),
    });
    await expect(
      adapter.send({
        idempotencyKey: "key",
        workspaceId: "workspace",
        deliveryId: "delivery",
        purpose: "marketing",
        to: "person@example.com",
        from: { email: "sender@example.com" },
        subject: "Subject",
        html: "<p>Hello</p>",
        text: "Hello",
      }),
    ).rejects.toBeInstanceOf(PermanentChannelError);
  });

  it("blocks private webhook targets", () => {
    expect(() => assertSafeWebhookUrl("http://example.com/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("https://127.0.0.1/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("https://169.254.169.254/latest")).toThrow();
    expect(() => new OutboundWebhookAdapter({ url: "https://hooks.example.com/a", secret: "x" }))
      .not.toThrow();
  });
});
