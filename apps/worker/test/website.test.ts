import { uuidv7 } from "@kaenma/db";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/crypto";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

describe("Website center", () => {
  it("manages and publishes forms, pages, site messages, and site tracking", async () => {
    const workspaceId = uuidv7();
    const userId = uuidv7();
    const apiKeyId = uuidv7();
    const prefix = "websitekeys1";
    const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
    const workspaceSlug = `website-${workspaceId}`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user
         (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, 'Website Owner', ?, 1, ?, ?)`,
      ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'Website Workspace', ?, ?, 'UTC')`,
      ).bind(workspaceId, workspaceSlug, Date.now()),
      env.DB.prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
         VALUES (?, ?, ?, 'Website test', ?, ?, 'owner', ?)`,
      ).bind(apiKeyId, workspaceId, userId, prefix, await sha256Hex(token), now),
    ]);
    const call = (path: string, init?: RequestInit) =>
      exports.default.fetch(
        new Request(`http://localhost:8787/api/v1${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            ...init?.headers,
          },
        }),
      );
    const publicCall = (path: string, init?: RequestInit) =>
      exports.default.fetch(
        new Request(`http://localhost:8787${path}`, {
          ...init,
          headers: {
            "content-type": "application/json",
            origin: "https://example.com",
            ...init?.headers,
          },
        }),
      );

    expect(
      (
        await call("/site-tracking", {
          method: "PUT",
          body: JSON.stringify({
            enabled: true,
            allowedDomains: ["https://example.com/path", "campaign.example.com"],
          }),
        })
      ).status,
    ).toBe(200);
    const trackingSettings = (await (await call("/site-tracking")).json()) as {
      data: { enabled: boolean; allowedDomains: string[]; workspaceSlug: string };
    };
    expect(trackingSettings.data).toMatchObject({
      enabled: true,
      allowedDomains: ["example.com", "campaign.example.com"],
      workspaceSlug,
    });

    const formResponse = await call("/forms", {
      method: "POST",
      body: JSON.stringify({
        name: "Newsletter",
        slug: "newsletter",
        status: "published",
        definition: {
          style: "inline",
          fields: [{ key: "email", type: "email", required: true }],
        },
        allowedDomains: ["example.com"],
        turnstileEnabled: false,
        successMessage: "登録しました。",
      }),
    });
    expect(formResponse.status).toBe(201);
    const form = (await formResponse.json()) as { data: { id: string } };
    const hostedForm = await publicCall(`/f/${workspaceSlug}/newsletter`, {
      headers: { origin: "" },
    });
    expect(hostedForm.status).toBe(200);
    expect(await hostedForm.text()).toContain("Newsletter");
    const formEmbed = await publicCall(
      `/api/public/forms/${workspaceSlug}/newsletter/embed.js`,
      { headers: { origin: "" } },
    );
    expect(formEmbed.status).toBe(200);
    expect(await formEmbed.text()).toContain('style === "inline"');
    const formSubmit = await publicCall(`/f/${workspaceSlug}/newsletter`, {
      method: "POST",
      body: JSON.stringify({
        email: "visitor@example.com",
        firstName: "Visitor",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(formSubmit.status).toBe(202);
    const listedForms = (await (await call("/forms")).json()) as {
      data: Array<{ id: string; submission_count: number }>;
    };
    expect(listedForms.data).toEqual([
      expect.objectContaining({ id: form.data.id, submission_count: 1 }),
    ]);

    const content = {
      schemaVersion: 1,
      backgroundColor: "#f4f5f7",
      contentColor: "#ffffff",
      width: 720,
      blocks: [
        {
          id: "hero",
          type: "text",
          html: "<h1>Welcome</h1><p>Join us.</p>",
        },
      ],
    };
    const pageResponse = await call("/pages", {
      method: "POST",
      body: JSON.stringify({
        name: "Welcome page",
        slug: "welcome",
        status: "draft",
        content,
      }),
    });
    expect(pageResponse.status).toBe(201);
    const page = (await pageResponse.json()) as { data: { id: string } };
    expect(
      (
        await call(`/pages/${page.data.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: "Welcome page",
            slug: "welcome",
            status: "published",
            content,
          }),
        })
      ).status,
    ).toBe(200);
    const hostedPage = await publicCall(`/p/${workspaceSlug}/welcome`, {
      headers: { origin: "" },
    });
    expect(hostedPage.status).toBe(200);
    expect(await hostedPage.text()).toContain("Welcome");

    const contactResponse = await call("/contacts", {
      method: "POST",
      body: JSON.stringify({ email: "known@example.com" }),
    });
    expect(contactResponse.status).toBe(201);

    const messageResponse = await call("/site-messages", {
      method: "POST",
      body: JSON.stringify({
        name: "Pricing help",
        status: "published",
        headline: "Need help?",
        body: "Talk with our team.",
        ctaLabel: "Contact us",
        ctaUrl: "https://example.com/contact",
        pagePattern: "/pricing*",
        startsAt: null,
        endsAt: null,
      }),
    });
    expect(messageResponse.status).toBe(201);
    const message = (await messageResponse.json()) as { data: { id: string } };
    const visitorId = crypto.randomUUID();
    const trackResponse = await publicCall(`/api/public/track/${workspaceSlug}`, {
      method: "POST",
      body: JSON.stringify({
        consent: true,
        visitorId,
        email: "known@example.com",
        type: "page_viewed",
        resourceId: "https://example.com/pricing/pro",
        properties: { title: "Pricing" },
      }),
    });
    expect(trackResponse.status).toBe(202);
    expect(await trackResponse.json()).toMatchObject({
      data: { accepted: true, identified: true, visitorId },
    });
    const messages = (await (
      await publicCall(
        `/api/public/site-messages/${workspaceSlug}?visitorId=${visitorId}` +
          `&url=${encodeURIComponent("https://example.com/pricing/pro")}`,
      )
    ).json()) as { data: Array<{ id: string }> };
    expect(messages.data).toEqual([
      expect.objectContaining({ id: message.data.id }),
    ]);
    expect(
      (
        await publicCall(
          `/api/public/site-messages/${workspaceSlug}/${message.data.id}/events`,
          {
            method: "POST",
            body: JSON.stringify({ visitorId, type: "impression" }),
          },
        )
      ).status,
    ).toBe(202);
    const siteMessages = (await (await call("/site-messages")).json()) as {
      data: Array<{ id: string; impression_count: number }>;
    };
    expect(siteMessages.data).toEqual([
      expect.objectContaining({ id: message.data.id, impression_count: 1 }),
    ]);

    const tracking = (await (await call("/site-tracking")).json()) as {
      data: {
        summary: { pageViews: number; identifiedContacts: number };
        topPages: Array<{ url: string; views: number }>;
      };
    };
    expect(tracking.data.summary).toMatchObject({
      pageViews: 1,
      identifiedContacts: 1,
    });
    expect(tracking.data.topPages).toEqual([
      {
        url: "https://example.com/pricing/pro",
        views: 1,
      },
    ]);
    const script = await publicCall(
      `/api/public/site-tracking/${workspaceSlug}/script.js`,
      { headers: { origin: "" } },
    );
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("application/javascript");
    expect(await script.text()).toContain("window.kaenma");
  });
});
