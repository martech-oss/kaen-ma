import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@kaenma/database";

import { sha256Hex } from "../src/crypto";

describe("workspace API journey", () => {
  it("moves a contact through segmentation, automation setup and dashboard reporting", async () => {
    const api = await seedApiWorkspace();

    const createdContact = await api("/contacts", {
      method: "POST",
      body: JSON.stringify({
        email: "journey@example.com",
        firstName: "Journey",
        customFields: { source: "e2e" },
      }),
    });
    expect(createdContact.status).toBe(201);
    const contact = await data<{ id: string; email: string }>(createdContact);
    expect(contact.email).toBe("journey@example.com");

    const createdSegment = await api("/segments", {
      method: "POST",
      body: JSON.stringify({
        name: "Active contacts",
        slug: "active-contacts",
        kind: "dynamic",
        filter: {
          kind: "condition",
          field: "status",
          operator: "eq",
          value: "active",
        },
      }),
    });
    expect(createdSegment.status).toBe(201);

    const preview = await api("/segments/preview", {
      method: "POST",
      body: JSON.stringify({
        kind: "condition",
        field: "email",
        operator: "eq",
        value: "journey@example.com",
      }),
    });
    await expect(
      data<Array<{ id: string; customFields: Record<string, unknown> }>>(preview),
    ).resolves.toEqual([
      expect.objectContaining({ id: contact.id, customFields: { source: "e2e" } }),
    ]);

    const campaign = await api("/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: "Welcome journey",
        description: "",
        timezone: "UTC",
        nodes: [
          {
            id: "source",
            type: "source",
            position: { x: 0, y: 0 },
            config: { source: "contact_created", reentry: "once" },
          },
        ],
        edges: [],
      }),
    });
    expect(campaign.status).toBe(201);

    const campaigns = await data<Array<{ name: string; status: string; enrollmentCount: number }>>(
      await api("/campaigns"),
    );
    expect(campaigns).toEqual([
      expect.objectContaining({ name: "Welcome journey", status: "draft", enrollmentCount: 0 }),
    ]);

    const segments = await data<Array<{ slug: string; memberCount: number }>>(
      await api("/segments"),
    );
    expect(segments).toEqual([
      expect.objectContaining({ slug: "active-contacts", memberCount: 1 }),
    ]);

    const dashboard = await data<{ contacts: { count: number }; recentEvents: unknown[] }>(
      await api("/dashboard"),
    );
    expect(dashboard.contacts.count).toBe(1);
    expect(dashboard.recentEvents).toEqual([
      expect.objectContaining({ contactId: contact.id, properties: {} }),
    ]);
  });

  it("rejects webhook endpoints that could target local infrastructure", async () => {
    const api = await seedApiWorkspace();
    const response = await api("/webhook-endpoints", {
      method: "POST",
      body: JSON.stringify({
        name: "Metadata service",
        url: "https://169.254.169.254/latest/meta-data",
        eventTypes: [],
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsafe_webhook_url" },
    });
  });
});

async function seedApiWorkspace(): Promise<
  (path: string, init?: RequestInit) => Promise<Response>
> {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const keyId = uuidv7();
  const prefix = `journey${crypto.randomUUID().replaceAll("-", "").slice(0, 5)}`;
  const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, 'Journey Owner', ?, 1, ?, ?)`,
    ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Journey Workspace', ?, ?, 'UTC')`,
    ).bind(workspaceId, `journey-${workspaceId}`, Date.now()),
    env.DB.prepare(
      `INSERT INTO api_keys
       (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
       VALUES (?, ?, ?, 'journey test', ?, ?, 'owner', ?)`,
    ).bind(keyId, workspaceId, userId, prefix, await sha256Hex(token), now),
  ]);

  return (path, init) =>
    exports.default.fetch(
      new Request(`http://localhost:8787/api/v1${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init?.body ? { "content-type": "application/json" } : {}),
        },
      }),
    );
}

async function data<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data: T };
  return payload.data;
}
