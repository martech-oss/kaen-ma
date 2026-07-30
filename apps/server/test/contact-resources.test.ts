import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@kaenma/database";
import { contract } from "@kaenma/orpc";

import { sha256Hex } from "../src/crypto";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function seedWorkspace(prefix: string, role = "owner") {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, 'Res Owner', ?, 1, ?, ?)`,
    ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Res Workspace', ?, ?, 'Asia/Tokyo')`,
    ).bind(workspaceId, `res-${workspaceId}`, Date.now()),
    env.DB.prepare(
      `INSERT INTO api_keys
       (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
       VALUES (?, ?, ?, 'res test', ?, ?, ?, ?)`,
    ).bind(
      uuidv7(),
      workspaceId,
      userId,
      prefix,
      await sha256Hex(token),
      role,
      new Date().toISOString(),
    ),
  ]);
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    headers: { authorization: `Bearer ${token}` },
    fetch: (request) => exports.default.fetch(request),
  });
  return createORPCClient(link) as ContractRouterClient<typeof contract>;
}

/**
 * These endpoints read snake_case columns and must publish camelCase. The
 * mapping is hand-written per column, so a typo cannot be caught by tsc --
 * only by asserting the values arrive populated.
 */
describe("contact resources over oRPC", () => {
  it("maps option rows to camelCase with counts", async () => {
    const client = await seedWorkspace("reskeyaaaaa1");
    const tag = await client.contactResources.createTag({ name: "VIP", color: "#0f766e" });
    const list = await client.contactResources.createList({
      name: "Customers",
      description: "paying",
      color: "#6366f1",
    });
    const contact = await client.contacts.create({
      email: "res@example.com",
      stage: "customer",
      customFields: {},
    });
    await client.contactResources.addTag({ contactId: contact.id, resourceId: tag.id });
    await client.contactResources.addList({ contactId: contact.id, resourceId: list.id });

    const options = await client.contactResources.options();
    expect(options.tags).toEqual([
      { id: tag.id, name: "VIP", slug: tag.slug, color: "#0f766e", contactCount: 1 },
    ]);
    expect(options.lists).toEqual([
      {
        id: list.id,
        name: "Customers",
        slug: list.slug,
        description: "paying",
        color: "#6366f1",
        contactCount: 1,
      },
    ]);
    expect(options.stages).toEqual([{ stage: "customer", contactCount: 1 }]);
  });

  it("maps the profile to camelCase, including the account relation", async () => {
    const client = await seedWorkspace("reskeybbbbb2");
    const account = await client.accounts.create({ name: "Globex" });
    const contact = await client.contacts.create({ email: "p@example.com", customFields: {} });
    await client.accounts.assignContact({
      id: account.id,
      contactId: contact.id,
      title: "VP",
      isPrimary: true,
    });
    await client.contactResources.adjustScore({
      contactId: contact.id,
      delta: 5,
      reason: "signup",
    });

    const profile = await client.contactResources.profile({ contactId: contact.id });
    expect(profile.accounts).toEqual([
      { id: account.id, name: "Globex", domain: null, title: "VP", isPrimary: true },
    ]);
    expect(profile.scoreEvents).toEqual([
      expect.objectContaining({ delta: 5, total: 5, reason: "signup" }),
    ]);
    expect(profile.scoreEvents[0]?.createdAt).toEqual(expect.any(String));
    expect(profile.contact.score).toBe(5);
  });

  it("requires admin for a bulk archive but allows marketer to tag", async () => {
    const client = await seedWorkspace("reskeyccccc3", "marketer");
    const tag = await client.contactResources.createTag({ name: "Bulk", color: "#64748b" });
    const contact = await client.contacts.create({ email: "b@example.com", customFields: {} });

    await expect(
      client.contactResources.bulkAction({ contactIds: [contact.id], action: "archive" }),
    ).rejects.toMatchObject({ code: "ARCHIVE_FORBIDDEN", status: 403 });

    await expect(
      client.contactResources.bulkAction({ contactIds: [contact.id], action: "add_tag" }),
    ).rejects.toMatchObject({ code: "RESOURCE_REQUIRED", status: 422 });

    await expect(
      client.contactResources.bulkAction({
        contactIds: [contact.id],
        action: "add_tag",
        resourceId: tag.id,
      }),
    ).resolves.toEqual({ updated: 1 });
  });

  it("rejects a duplicate tag name", async () => {
    const client = await seedWorkspace("reskeyddddd4");
    await client.contactResources.createTag({ name: "Dup", color: "#64748b" });
    await expect(
      client.contactResources.createTag({ name: "Dup", color: "#64748b" }),
    ).rejects.toMatchObject({ code: "TAG_CONFLICT", status: 409 });
  });
});
