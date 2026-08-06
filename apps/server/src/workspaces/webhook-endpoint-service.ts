import { desc, eq } from "drizzle-orm";

import { assertSafeWebhookUrl } from "@openengage/channels";
import { uuidv7, webhookEndpoints, type OpenEngageDatabase } from "@openengage/database";
import type { WebhookEndpointRow } from "@openengage/orpc";

import { encryptCredentials } from "../platform/crypto";
import { randomString } from "../platform/crypto";
import { parseJsonValue } from "../platform/values";

export async function listWebhookEndpoints(
  database: OpenEngageDatabase,
  workspaceId: string,
): Promise<WebhookEndpointRow[]> {
  const rows = await database.orm
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.workspaceId, workspaceId))
    .orderBy(desc(webhookEndpoints.updatedAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    eventTypes: parseJsonValue<string[]>(row.eventTypes, []),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export type WebhookEndpointCreateOutcome =
  | { kind: "unsafe_url" }
  | { kind: "created"; id: string; signingSecret: string };

export async function createWebhookEndpoint(
  database: OpenEngageDatabase,
  encryptionKey: string,
  workspaceId: string,
  input: { name: string; url: string; eventTypes: string[] },
): Promise<WebhookEndpointCreateOutcome> {
  try {
    assertSafeWebhookUrl(input.url);
  } catch {
    return { kind: "unsafe_url" };
  }
  const secret = randomString(40);
  const encryptedSecret = await encryptCredentials(encryptionKey, { secret });
  const id = uuidv7();
  const now = new Date().toISOString();
  await database.orm.insert(webhookEndpoints).values({
    id,
    workspaceId,
    name: input.name,
    url: input.url,
    encryptedSecret,
    eventTypes: JSON.stringify(input.eventTypes),
    createdAt: now,
    updatedAt: now,
  });
  return { kind: "created", id, signingSecret: secret };
}
