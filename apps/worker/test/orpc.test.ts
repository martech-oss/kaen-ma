import { contract } from "@kaenma/api-contract";
import { uuidv7 } from "@kaenma/db";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/crypto";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

function createClient(token?: string): ContractRouterClient<typeof contract> {
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    ...(token
      ? { headers: { authorization: `Bearer ${token}` } }
      : {}),
    fetch: (request) => exports.default.fetch(request),
  });
  return createORPCClient(link);
}

describe("oRPC API", () => {
  it("returns a typed authentication error without credentials", async () => {
    await expect(createClient().workspace.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      defined: true,
    });
  });

  it("returns the legacy admin error envelope through oRPC", async () => {
    const response = await createClient().admin.request({
      path: "/dashboard",
      method: "GET",
    });
    expect(response).toMatchObject({
      status: 401,
      payload: {
        error: {
          code: "unauthorized",
        },
      },
    });
  });

  it("gets a workspace and creates and lists contacts", async () => {
    const workspaceId = uuidv7();
    const userId = uuidv7();
    const apiKeyId = uuidv7();
    const prefix = "orpctestkey1";
    const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
    const now = new Date().toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user
         (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, 'oRPC Owner', ?, 1, ?, ?)`,
      ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'oRPC Workspace', ?, ?, 'Asia/Tokyo')`,
      ).bind(workspaceId, `orpc-${workspaceId}`, Date.now()),
      env.DB.prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
         VALUES (?, ?, ?, 'oRPC test', ?, ?, 'owner', ?)`,
      ).bind(
        apiKeyId,
        workspaceId,
        userId,
        prefix,
        await sha256Hex(token),
        now,
      ),
    ]);

    const client = createClient(token);
    await expect(client.workspace.get()).resolves.toMatchObject({
      id: workspaceId,
      name: "oRPC Workspace",
      timezone: "Asia/Tokyo",
      role: "owner",
    });

    const created = await client.contacts.create({
      email: "orpc-contact@example.com",
      firstName: "RPC",
      stage: "lead",
      customFields: {},
    });
    expect(created).toMatchObject({
      email: "orpc-contact@example.com",
      firstName: "RPC",
      status: "active",
    });

    const page = await client.contacts.list({
      query: "orpc-contact@example.com",
      status: "active",
      limit: 20,
    });
    expect(page.total).toBe(1);
    expect(page.items).toEqual([
      expect.objectContaining({
        id: created.id,
        tags: [],
        lists: [],
        accounts: [],
      }),
    ]);

    await expect(
      client.contacts.create({
        email: "orpc-contact@example.com",
        customFields: {},
      }),
    ).rejects.toMatchObject({
      code: "CONTACT_CONFLICT",
      status: 409,
    });

    const dashboard = await client.admin.request({
      path: "/dashboard",
      method: "GET",
    });
    expect(dashboard).toMatchObject({
      status: 200,
      payload: {
        data: {
          contacts: { count: 1 },
        },
      },
    });

    const tagName = `oRPC tag ${workspaceId}`;
    const createdTag = await client.admin.request({
      path: "/tags",
      method: "POST",
      body: JSON.stringify({
        name: tagName,
        color: "#0f766e",
      }),
    });
    expect(createdTag).toMatchObject({
      status: 201,
      payload: {
        data: {
          name: tagName,
          color: "#0f766e",
        },
      },
    });
  });
});
