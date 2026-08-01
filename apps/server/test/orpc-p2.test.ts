import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@kaenma/database";
import { contract } from "@kaenma/orpc";

import { sha256Hex } from "../src/platform/crypto";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

type Client = ContractRouterClient<typeof contract>;

async function createWorkspaceClient(): Promise<{ client: Client; workspaceId: string }> {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const prefix = uuidv7().replaceAll("-", "").slice(0, 12);
  const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, 'P2 Owner', ?, 1, ?, ?)`,
    ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'P2 Workspace', ?, ?, 'UTC')`,
    ).bind(workspaceId, `p2-${workspaceId}`, Date.now()),
    env.DB.prepare(
      `INSERT INTO api_keys
       (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
       VALUES (?, ?, ?, 'P2 test', ?, ?, 'owner', ?)`,
    ).bind(uuidv7(), workspaceId, userId, prefix, await sha256Hex(token), new Date().toISOString()),
  ]);
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    headers: { authorization: `Bearer ${token}` },
    fetch: (request) => exports.default.fetch(request),
  });
  return { client: createORPCClient(link), workspaceId };
}

describe("oRPC contract completion (P2)", () => {
  it("manages subscription topics", async () => {
    const { client } = await createWorkspaceClient();
    const created = await client.consent.createTopic({
      name: "Newsletter",
      slug: "newsletter",
      description: "Monthly news",
      isDefault: true,
    });
    expect(created.id).toBeTruthy();
    const topics = await client.consent.listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ slug: "newsletter", isDefault: true });
    await expect(
      client.consent.createTopic({
        name: "Duplicate",
        slug: "newsletter",
        description: "",
        isDefault: false,
      }),
    ).rejects.toMatchObject({ code: "TOPIC_CONFLICT", status: 409 });
  });

  it("manages projects and project items", async () => {
    const { client } = await createWorkspaceClient();
    const { id } = await client.projects.create({
      name: "Spring launch",
      description: "",
      color: "#7c3aed",
    });
    const first = await client.projects.addItem({
      id,
      resourceType: "segment",
      resourceId: "segment-a",
    });
    expect(first.added).toBe(true);
    const second = await client.projects.addItem({
      id,
      resourceType: "segment",
      resourceId: "segment-a",
    });
    expect(second.added).toBe(false);
    const projects = await client.projects.list();
    expect(projects[0]).toMatchObject({ id, name: "Spring launch", itemCount: 1 });
    await expect(
      client.projects.addItem({ id: uuidv7(), resourceType: "segment", resourceId: "x" }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("manages webhook endpoints with URL safety checks", async () => {
    const { client } = await createWorkspaceClient();
    const created = await client.workspace.createWebhookEndpoint({
      name: "CRM sync",
      url: "https://hooks.example.com/kaenma",
      eventTypes: ["contact.created"],
    });
    expect(created.signingSecret.length).toBeGreaterThanOrEqual(40);
    const endpoints = await client.workspace.listWebhookEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      name: "CRM sync",
      url: "https://hooks.example.com/kaenma",
      eventTypes: ["contact.created"],
      enabled: true,
    });
    await expect(
      client.workspace.createWebhookEndpoint({
        name: "Private",
        url: "https://10.0.0.8/hook",
        eventTypes: [],
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_WEBHOOK_URL", status: 422 });
  });

  it("reads a contact, its timeline, and records custom events", async () => {
    const { client } = await createWorkspaceClient();
    const contact = await client.contacts.create({
      email: "timeline@example.com",
      customFields: {},
    });
    const fetched = await client.contacts.get({ id: contact.id });
    expect(fetched.email).toBe("timeline@example.com");
    const recorded = await client.contacts.recordEvent({
      id: contact.id,
      eventName: "plan_upgraded",
      source: "api",
      properties: { plan: "pro" },
    });
    expect(recorded.eventId).toBeTruthy();
    const timeline = await client.contacts.timeline({ id: contact.id });
    const types = timeline.map((event) => event.type);
    expect(types).toContain("contact_created");
    expect(types).toContain("custom_event");
    const custom = timeline.find((event) => event.type === "custom_event");
    expect(custom).toMatchObject({ resourceId: "plan_upgraded", properties: { plan: "pro" } });
    await expect(client.contacts.timeline({ id: uuidv7() })).rejects.toMatchObject({
      code: "CONTACT_NOT_FOUND",
    });
  });

  it("previews a segment filter without persisting it", async () => {
    const { client } = await createWorkspaceClient();
    await client.contacts.create({ email: "match@acme.dev", customFields: {} });
    await client.contacts.create({ email: "other@different.io", customFields: {} });
    const preview = await client.segments.preview({
      filter: { kind: "condition", field: "email", operator: "contains", value: "acme.dev" },
    });
    expect(preview.capped).toBe(false);
    expect(preview.contacts).toHaveLength(1);
    expect(preview.contacts[0]?.email).toBe("match@acme.dev");
  });

  it("creates an API key whose token authenticates with its prefix", async () => {
    const { client } = await createWorkspaceClient();
    const created = await client.operations.createApiKey({ name: "CI key", role: "analyst" });
    expect(created.token.startsWith(`kaenma_${created.prefix}_`)).toBe(true);
    const link = new RPCLink({
      url: "http://localhost:8787/api/rpc",
      headers: { authorization: `Bearer ${created.token}` },
      fetch: (request) => exports.default.fetch(request),
    });
    const analystClient: Client = createORPCClient(link);
    await expect(analystClient.workspace.get()).resolves.toMatchObject({ role: "analyst" });
  });

  it("starts a contact export and reports its data job", async () => {
    const { client } = await createWorkspaceClient();
    const { jobId } = await client.operations.exportContacts();
    const job = await client.operations.getDataJob({ id: jobId });
    expect(job).toMatchObject({ id: jobId, kind: "contact_export", status: "pending" });
    await expect(client.operations.downloadContactExport({ id: jobId })).rejects.toMatchObject({
      code: "EXPORT_NOT_READY",
    });
  });

  it("accepts a CSV import file and rejects one without identifiers", async () => {
    const { client } = await createWorkspaceClient();
    const csv = "email,first_name\nimport-a@example.com,Ay\nimport-b@example.com,Bee\n";
    const started = await client.operations.importContacts({
      file: new File([csv], "contacts.csv", { type: "text/csv" }),
    });
    expect(started).toMatchObject({ rows: 2, parts: 1 });
    await expect(
      client.operations.importContacts({
        file: new File(["first_name\nNoId\n"], "broken.csv", { type: "text/csv" }),
      }),
    ).rejects.toMatchObject({ code: "CSV_IDENTIFIER_MISSING" });
  });

  it("uploads and downloads an asset through R2", async () => {
    const { client } = await createWorkspaceClient();
    const uploaded = await client.assets.upload({
      name: "logo.svg",
      file: new File(["<svg>kaenma</svg>"], "logo.svg", { type: "image/svg+xml" }),
    });
    expect(uploaded).toMatchObject({ name: "logo.svg", contentType: "image/svg+xml" });
    const file = await client.assets.download({ id: uploaded.id });
    expect(await file.text()).toBe("<svg>kaenma</svg>");
    await expect(client.assets.download({ id: uuidv7() })).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
  });

  it("lists dead letters and rejects replaying unknown entries", async () => {
    const { client } = await createWorkspaceClient();
    await expect(client.operations.listDeadLetters()).resolves.toEqual([]);
    await expect(client.operations.replayDeadLetter({ id: uuidv7() })).rejects.toMatchObject({
      code: "DEAD_LETTER_NOT_FOUND",
    });
  });

  it("guards manual enrollment and serves per-campaign analytics", async () => {
    const { client } = await createWorkspaceClient();
    await expect(
      client.campaigns.enroll({ id: uuidv7(), contactId: uuidv7() }),
    ).rejects.toMatchObject({ code: "CAMPAIGN_NOT_ACTIVE" });
    await expect(client.campaigns.analytics({ id: uuidv7() })).resolves.toEqual({
      enrollments: [],
      deliveries: [],
    });
    await expect(client.emails.getCampaign({ id: uuidv7() })).rejects.toMatchObject({
      code: "BROADCAST_NOT_FOUND",
    });
  });
});
