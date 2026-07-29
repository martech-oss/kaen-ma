import { describe, expect, it } from "vitest";
import {
  CloudflareEmailAdapter,
  OutboundWebhookAdapter,
  PermanentChannelError,
  ResendEmailAdapter,
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

  it("sends marketing email through Resend with idempotency and unsubscribe headers", async () => {
    let request:
      | { input: string; headers: Headers; body: string }
      | undefined;
    const adapter = new ResendEmailAdapter({
      apiKey: "re_test_key",
      fetcher: (async (input, init) => {
        request = {
          input: String(input),
          headers: new Headers(init?.headers),
          body: String(init?.body),
        };
        return new Response(JSON.stringify({ id: "resend-message-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });

    const result = await adapter.send({
      idempotencyKey: "delivery-key",
      workspaceId: "workspace-id",
      deliveryId: "delivery-id",
      purpose: "marketing",
      to: "person@example.com",
      from: { email: "sender@example.com", name: "Kaenma" },
      replyTo: "reply@example.com",
      subject: "Subject",
      html: "<p>Hello</p>",
      text: "Hello",
      metadata: { unsubscribeUrl: "https://example.com/u/signed-token" },
    });

    expect(result.providerMessageId).toBe("resend-message-id");
    expect(request!.input).toBe("https://api.resend.com/emails");
    expect(request!.headers.get("Authorization")).toBe("Bearer re_test_key");
    expect(request!.headers.get("Idempotency-Key")).toBe("delivery-key");
    const body = JSON.parse(request!.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: "Kaenma <sender@example.com>",
      to: ["person@example.com"],
      reply_to: "reply@example.com",
      headers: {
        "List-Unsubscribe": "<https://example.com/u/signed-token>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [
        { name: "kaenma_delivery_id", value: "delivery-id" },
        { name: "kaenma_workspace_id", value: "workspace-id" },
      ],
    });
  });

  it("rejects transactional messages in the Resend marketing adapter", async () => {
    const adapter = new ResendEmailAdapter({ apiKey: "re_test_key" });
    await expect(
      adapter.send({
        idempotencyKey: "key",
        workspaceId: "workspace",
        deliveryId: "delivery",
        purpose: "transactional",
        to: "person@example.com",
        from: { email: "sender@example.com" },
        subject: "Subject",
        html: "<p>Hello</p>",
        text: "Hello",
      }),
    ).rejects.toBeInstanceOf(PermanentChannelError);
  });

  it("verifies and normalizes Resend Svix webhooks", async () => {
    const secret = `whsec_${btoa("resend-webhook-secret")}`;
    const eventId = "msg_event_id";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({
      type: "email.delivered",
      created_at: "2026-07-29T01:00:00.000Z",
      data: {
        email_id: "email-id",
        tags: {
          kaenma_delivery_id: "delivery-id",
          kaenma_workspace_id: "workspace-id",
        },
      },
    });
    const signature = await svixSignature(
      "resend-webhook-secret",
      `${eventId}.${timestamp}.${rawBody}`,
    );
    const adapter = new ResendEmailAdapter({
      apiKey: "re_test_key",
      webhookSecret: secret,
    });
    const request = new Request("https://example.com/api/webhooks/resend/workspace-id", {
      method: "POST",
      headers: {
        "svix-id": eventId,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
      body: rawBody,
    });

    await expect(adapter.verifyWebhook(request, rawBody)).resolves.toEqual({
      valid: true,
      eventId,
    });
    expect(adapter.normalizeEvents(JSON.parse(rawBody), "workspace-id", eventId)).toEqual([
      expect.objectContaining({
        id: eventId,
        workspaceId: "workspace-id",
        deliveryId: "delivery-id",
        provider: "resend",
        providerMessageId: "email-id",
        type: "delivered",
      }),
    ]);
  });
});

async function svixSignature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return btoa(String.fromCharCode(...signature));
}
