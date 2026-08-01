import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { exports } from "cloudflare:workers";

import { apiKeys, createDatabase, member, organization, user, uuidv7 } from "@kaenma/database";
import { contract, type WorkspaceRole } from "@kaenma/orpc";

import { randomIdentifier, sha256Hex } from "../src/platform/crypto";

export interface WorkspaceFixture {
  workspaceId: string;
  userId: string;
  prefix: string;
  token: string;
  /** Organization slug, used by the public (unauthenticated) routes. */
  slug: string;
}

export interface SeedWorkspaceOptions {
  /** API key role; defaults to "owner". */
  role?: WorkspaceRole;
  /** Organization (workspace) name; defaults to "Test Workspace". */
  name?: string;
  /** Organization timezone; defaults to "UTC". */
  timezone?: string;
}

/**
 * Seeds a workspace — user, organization and API key — through the Drizzle
 * client and returns the pieces tests need to talk to it. The returned token
 * authenticates at `options.role` via the regular Bearer header.
 */
export async function seedWorkspace(
  db: D1Database,
  options: SeedWorkspaceOptions = {},
): Promise<WorkspaceFixture> {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const prefix = randomIdentifier(12);
  const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
  const slug = `ws-${workspaceId}`;
  const now = new Date();
  const orm = createDatabase(db).orm;
  await orm.batch([
    orm.insert(user).values({
      id: userId,
      name: "Test Owner",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(organization).values({
      id: workspaceId,
      name: options.name ?? "Test Workspace",
      slug,
      createdAt: now,
      timezone: options.timezone ?? "UTC",
    }),
    orm.insert(apiKeys).values({
      id: uuidv7(),
      workspaceId,
      createdByUserId: userId,
      name: "test key",
      prefix,
      keyHash: await sha256Hex(token),
      role: options.role ?? "owner",
      createdAt: now.toISOString(),
    }),
  ]);
  return { workspaceId, userId, prefix, token, slug };
}

/** Adds the fixture user to the organization's member table (deal/report tests read it). */
export async function seedMember(
  db: D1Database,
  input: { workspaceId: string; userId: string; role?: WorkspaceRole },
): Promise<void> {
  await createDatabase(db)
    .orm.insert(member)
    .values({
      id: uuidv7(),
      organizationId: input.workspaceId,
      userId: input.userId,
      role: input.role ?? "owner",
      createdAt: new Date(),
    });
}

/** Typed oRPC client for a seeded fixture, driven through the worker's fetch handler. */
export function createFixtureClient(fixture: {
  token: string;
}): ContractRouterClient<typeof contract> {
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    headers: { authorization: `Bearer ${fixture.token}` },
    fetch: (request) => exports.default.fetch(request),
  });
  return createORPCClient(link);
}

/** Convenience: seed a workspace and return the fixture together with a typed client. */
export async function seedWorkspaceClient(
  db: D1Database,
  options: SeedWorkspaceOptions = {},
): Promise<WorkspaceFixture & { client: ContractRouterClient<typeof contract> }> {
  const fixture = await seedWorkspace(db, options);
  return { ...fixture, client: createFixtureClient(fixture) };
}
