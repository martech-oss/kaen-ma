import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase, uuidv7 } from "@kaenma/database";
import { contract } from "@kaenma/orpc";

import { enrollInactiveContacts } from "../src/automations/enrollment";
import { sha256Hex } from "../src/platform/crypto";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

type Client = ContractRouterClient<typeof contract>;

describe("Automation flows", () => {
  it("enrolls a newly created contact into a published welcome flow", async () => {
    const { client, workspaceId } = await createWorkspaceClient();
    const campaign = await client.campaigns.create({
      name: "Welcome flow",
      description: "Welcome new contacts",
      timezone: "Asia/Tokyo",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created", reentry: "once" },
        },
        {
          id: "score",
          type: "action",
          position: { x: 200, y: 0 },
          config: { action: "change_score", amount: 5 },
        },
      ],
      edges: [{ id: "source-score", source: "source", target: "score", branch: "next" }],
    });
    expect(campaign.id).toBeTruthy();
    const published = await client.campaigns.publish({ id: campaign.id });
    expect(published.publishedVersionId).toBeTruthy();

    const contact = await client.contacts.create({
      email: "welcome@example.com",
      customFields: {},
    });
    const enrollment = await env.DB.prepare(
      `SELECT ce.status, ce.current_node_id, ce.source_event_id, cj.status AS job_status
       FROM campaign_enrollments ce
       JOIN campaign_jobs cj ON cj.enrollment_id = ce.id
       WHERE ce.workspace_id = ? AND ce.campaign_id = ? AND ce.contact_id = ?`,
    )
      .bind(workspaceId, campaign.id, contact.id)
      .first<{
        status: string;
        current_node_id: string;
        source_event_id: string;
        job_status: string;
      }>();
    expect(enrollment).toMatchObject({
      status: "active",
      current_node_id: "source",
      source_event_id: "once",
      job_status: "pending",
    });
  });

  it("supports repeatable cart events and once-only inactivity enrollment", async () => {
    const { client, workspaceId } = await createWorkspaceClient();
    const contact = await client.contacts.create({
      email: "behavior@example.com",
      customFields: {},
    });
    const cartCampaignId = await createAndPublishSingleActionFlow(client, {
      name: "Cart flow",
      source: {
        source: "api_event",
        eventName: "cart_abandoned",
        reentry: "every_time",
      },
    });

    for (let index = 0; index < 2; index += 1) {
      const recorded = await client.contacts.recordEvent({
        id: contact.id,
        eventName: "cart_abandoned",
        properties: { cartId: `cart-${index}` },
      });
      expect(recorded).toMatchObject({ enrollmentCount: 1 });
    }
    const cartEnrollments = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM campaign_enrollments
       WHERE workspace_id = ? AND campaign_id = ? AND contact_id = ?`,
    )
      .bind(workspaceId, cartCampaignId, contact.id)
      .first<{ count: number }>();
    expect(cartEnrollments?.count).toBe(2);

    const inactivityCampaignId = await createAndPublishSingleActionFlow(client, {
      name: "Re-engagement flow",
      source: { source: "contact_inactive", days: 30, reentry: "once" },
    });
    await env.DB.prepare(
      `UPDATE contacts SET created_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ?`,
    )
      .bind("2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", workspaceId, contact.id)
      .run();
    await env.DB.prepare("DELETE FROM contact_events WHERE workspace_id = ? AND contact_id = ?")
      .bind(workspaceId, contact.id)
      .run();

    expect(
      await enrollInactiveContacts(createDatabase(env.DB), new Date("2026-07-30T00:00:00.000Z")),
    ).toBe(1);
    expect(
      await enrollInactiveContacts(createDatabase(env.DB), new Date("2026-07-30T00:01:00.000Z")),
    ).toBe(0);
    const inactivityEnrollments = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM campaign_enrollments
       WHERE workspace_id = ? AND campaign_id = ? AND contact_id = ?`,
    )
      .bind(workspaceId, inactivityCampaignId, contact.id)
      .first<{ count: number }>();
    expect(inactivityEnrollments?.count).toBe(1);
  });
});

async function createAndPublishSingleActionFlow(
  client: Client,
  input: {
    name: string;
    source:
      | { source: "api_event"; eventName: string; reentry: "every_time" }
      | { source: "contact_inactive"; days: number; reentry: "once" };
  },
): Promise<string> {
  const created = await client.campaigns.create({
    name: input.name,
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: input.source,
      },
      {
        id: "score",
        type: "action",
        position: { x: 200, y: 0 },
        config: { action: "change_score", amount: 1 },
      },
    ],
    edges: [{ id: "source-score", source: "source", target: "score", branch: "next" }],
  });
  expect(created.id).toBeTruthy();
  const published = await client.campaigns.publish({ id: created.id });
  expect(published.publishedVersionId).toBeTruthy();
  return created.id;
}

async function createWorkspaceClient(): Promise<{ client: Client; workspaceId: string }> {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const prefix = uuidv7().replaceAll("-", "").slice(0, 12);
  const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, 'Automation Owner', ?, 1, ?, ?)`,
    ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Automation Workspace', ?, ?, 'UTC')`,
    ).bind(workspaceId, `automation-${workspaceId}`, Date.now()),
    env.DB.prepare(
      `INSERT INTO api_keys
       (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
       VALUES (?, ?, ?, 'Automation test', ?, ?, 'owner', ?)`,
    ).bind(uuidv7(), workspaceId, userId, prefix, await sha256Hex(token), new Date().toISOString()),
  ]);
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    headers: { authorization: `Bearer ${token}` },
    fetch: (request) => exports.default.fetch(request),
  });
  return { client: createORPCClient(link), workspaceId };
}
