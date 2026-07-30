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

type Client = ContractRouterClient<typeof contract>;

function createClient(token: string): Client {
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    headers: { authorization: `Bearer ${token}` },
    fetch: (request) => exports.default.fetch(request),
  });
  return createORPCClient(link);
}

/** Seeds a workspace with an API key at the given role and returns a client for it. */
async function seedWorkspace(prefix: string, role = "owner") {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, 'Accounts Owner', ?, 1, ?, ?)`,
    ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Accounts Workspace', ?, ?, 'Asia/Tokyo')`,
    ).bind(workspaceId, `accounts-${workspaceId}`, Date.now()),
    env.DB.prepare(
      `INSERT INTO api_keys
       (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
       VALUES (?, ?, ?, 'accounts test', ?, ?, ?, ?)`,
    ).bind(uuidv7(), workspaceId, userId, prefix, await sha256Hex(token), role, now),
  ]);
  return { workspaceId, client: createClient(token) };
}

describe("accounts over oRPC", () => {
  it("creates, reads, updates and lists an account", async () => {
    const { workspaceId, client } = await seedWorkspace("acctkeyaaaa1");

    const created = await client.accounts.create({ name: "Acme Inc", domain: "acme.example" });
    expect(created).toMatchObject({
      workspaceId,
      name: "Acme Inc",
      domain: "acme.example",
    });

    const detail = await client.accounts.get({ id: created.id });
    expect(detail).toMatchObject({ id: created.id, name: "Acme Inc", contacts: [] });

    const updated = await client.accounts.update({ id: created.id, name: "Acme Group" });
    expect(updated).toMatchObject({ id: created.id, name: "Acme Group" });

    const listed = await client.accounts.list({ query: "Acme" });
    expect(listed).toEqual([
      expect.objectContaining({ id: created.id, name: "Acme Group", contactCount: 0 }),
    ]);
  });

  it("reports a typed error for an account in another workspace", async () => {
    const { client } = await seedWorkspace("acctkeybbbb2");
    const other = await seedWorkspace("acctkeycccc3");
    const hidden = await other.client.accounts.create({ name: "Hidden Co" });

    await expect(client.accounts.get({ id: hidden.id })).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
      status: 404,
      defined: true,
    });
  });

  it("attaches a contact, exposes it in camelCase, and counts it", async () => {
    const { client } = await seedWorkspace("acctkeydddd4");
    const account = await client.accounts.create({ name: "Contoso" });
    const contact = await client.contacts.create({
      email: "person@contoso.example",
      firstName: "Taro",
      lastName: "Yamada",
      customFields: {},
    });

    await expect(
      client.accounts.assignContact({
        id: account.id,
        contactId: contact.id,
        title: "CTO",
        isPrimary: true,
      }),
    ).resolves.toEqual({ assigned: true });

    const detail = await client.accounts.get({ id: account.id });
    expect(detail.contacts).toEqual([
      expect.objectContaining({
        id: contact.id,
        firstName: "Taro",
        lastName: "Yamada",
        title: "CTO",
        isPrimary: true,
        status: "active",
      }),
    ]);

    const listed = await client.accounts.list({});
    expect(listed.find((row) => row.id === account.id)?.contactCount).toBe(1);

    await expect(
      client.accounts.removeContact({ id: account.id, contactId: contact.id }),
    ).resolves.toEqual({ removed: true });
    await expect(client.accounts.get({ id: account.id })).resolves.toMatchObject({ contacts: [] });
  });

  it("rejects attaching a contact that does not exist", async () => {
    const { client } = await seedWorkspace("acctkeyeeee5");
    const account = await client.accounts.create({ name: "Initech" });

    await expect(
      client.accounts.assignContact({
        id: account.id,
        contactId: uuidv7(),
        isPrimary: false,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_CONTACT_NOT_FOUND", status: 404 });
  });

  it("rejects a write from a role below marketer", async () => {
    const { client } = await seedWorkspace("acctkeyffff6", "viewer");

    await expect(client.accounts.create({ name: "Readonly Co" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  // The REST routes stay for the SDK, MCP server and OpenAPI document. They now
  // delegate to the same service functions as the oRPC procedures, so they are
  // checked here to catch the two surfaces drifting apart.
  it("serves the same data over the REST routes", async () => {
    const { client } = await seedWorkspace("acctkeygggg7");
    const created = await client.accounts.create({ name: "Umbrella", domain: "umbrella.example" });

    const listed = await client.admin.request({ path: "/accounts?q=Umbrella", method: "GET" });
    expect(listed).toMatchObject({
      status: 200,
      payload: { data: [expect.objectContaining({ id: created.id, contactCount: 0 })] },
    });

    const detail = await client.admin.request({ path: `/accounts/${created.id}`, method: "GET" });
    expect(detail).toMatchObject({
      status: 200,
      payload: { data: { id: created.id, name: "Umbrella", contacts: [] } },
    });

    const missing = await client.admin.request({ path: `/accounts/${uuidv7()}`, method: "GET" });
    expect(missing).toMatchObject({
      status: 404,
      payload: { error: { code: "account_not_found" } },
    });

    const conflict = await client.admin.request({
      path: "/accounts",
      method: "POST",
      body: JSON.stringify({ name: "Umbrella Two", domain: "umbrella.example" }),
    });
    expect(conflict).toMatchObject({
      status: 409,
      payload: { error: { code: "account_conflict" } },
    });
  });
});
