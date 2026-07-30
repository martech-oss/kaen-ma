import type { Resend } from "resend";
import { describe, expect, it } from "vitest";

import {
  OutboundWebhookAdapter,
  ResendEmailAdapter,
  ResendTemplateAdapter,
  assertSafeWebhookUrl,
} from "./index";

describe("channel policy", () => {
  it("blocks private webhook targets", () => {
    expect(() => assertSafeWebhookUrl("http://example.com/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("https://127.0.0.1/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("https://169.254.169.254/latest")).toThrow();
    expect(
      () => new OutboundWebhookAdapter({ url: "https://hooks.example.com/a", secret: "x" }),
    ).not.toThrow();
  });

  it("sends a hosted marketing template with idempotency and unsubscribe headers", async () => {
    const calls: unknown[][] = [];
    const client = {
      emails: {
        send: async (...args: unknown[]) => {
          calls.push(args);
          return { data: { id: "resend-message-id" }, error: null };
        },
      },
    } as unknown as Resend;
    const adapter = new ResendEmailAdapter({
      apiKey: "re_test_key",
      client,
    });

    const result = await adapter.send({
      kind: "email",
      idempotencyKey: "delivery-key",
      workspaceId: "workspace-id",
      deliveryId: "delivery-id",
      purpose: "marketing",
      to: "person@example.com",
      from: { email: "sender@example.com", name: "Kaenma" },
      replyTo: "reply@example.com",
      template: {
        id: "welcome-email",
        variables: { CONTACT_FIRST_NAME: "Yosa" },
      },
      metadata: { unsubscribeUrl: "https://example.com/u/signed-token" },
    });

    expect(result.providerMessageId).toBe("resend-message-id");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({
      from: "Kaenma <sender@example.com>",
      to: ["person@example.com"],
      replyTo: "reply@example.com",
      template: {
        id: "welcome-email",
        variables: { CONTACT_FIRST_NAME: "Yosa" },
      },
      headers: {
        "List-Unsubscribe": "<https://example.com/u/signed-token>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [
        { name: "kaenma_delivery_id", value: "delivery-id" },
        { name: "kaenma_workspace_id", value: "workspace-id" },
      ],
    });
    expect(calls[0]?.[1]).toEqual({ idempotencyKey: "delivery-key" });
  });

  it("sends transactional hosted templates without marketing headers", async () => {
    const calls: unknown[][] = [];
    const client = {
      emails: {
        send: async (...args: unknown[]) => {
          calls.push(args);
          return { data: { id: "transactional-id" }, error: null };
        },
      },
    } as unknown as Resend;
    const adapter = new ResendEmailAdapter({ apiKey: "re_test_key", client });

    await expect(
      adapter.send({
        kind: "email",
        idempotencyKey: "transactional-key",
        purpose: "transactional",
        to: "person@example.com",
        from: { email: "system@example.com" },
        template: {
          id: "password-reset",
          variables: { ACTION_URL: "https://example.com/reset" },
        },
      }),
    ).resolves.toMatchObject({ providerMessageId: "transactional-id" });
    expect(calls[0]?.[0]).not.toHaveProperty("headers");
    expect(calls[0]?.[0]).not.toHaveProperty("tags");
  });

  it("normalizes hosted template metadata from Resend", async () => {
    const client = {
      templates: {
        get: async () => ({
          data: {
            id: "template-id",
            alias: "welcome-email",
            name: "Welcome",
            subject: "Hello {{{CONTACT_FIRST_NAME}}}",
            status: "published",
            current_version_id: "version-id",
            has_unpublished_versions: false,
            published_at: "2026-07-30T00:00:00.000Z",
            updated_at: "2026-07-30T01:00:00.000Z",
            variables: [
              {
                key: "CONTACT_FIRST_NAME",
                type: "string",
                fallback_value: "there",
              },
            ],
          },
          error: null,
        }),
      },
    } as unknown as Resend;
    const adapter = new ResendTemplateAdapter({ apiKey: "re_test_key", client });

    await expect(adapter.get("welcome-email")).resolves.toEqual({
      id: "template-id",
      alias: "welcome-email",
      name: "Welcome",
      subject: "Hello {{{CONTACT_FIRST_NAME}}}",
      status: "published",
      currentVersionId: "version-id",
      hasUnpublishedVersions: false,
      publishedAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T01:00:00.000Z",
      variables: [
        {
          key: "CONTACT_FIRST_NAME",
          type: "string",
          fallbackValue: "there",
        },
      ],
    });
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
    const request = new Request("https://example.com/api/webhooks/resend", {
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
    expect(adapter.normalizeEvents(JSON.parse(rawBody), eventId)).toEqual([
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
