import { desc, eq } from "drizzle-orm";

import { assertSafeWebhookUrl } from "@kaenma/channels";
import { uuidv7, webhookEndpoints, type KaenmaDatabase } from "@kaenma/database";
import type { WebhookEndpointRow } from "@kaenma/orpc";

import { encryptCredentials } from "../platform/crypto";
import { randomString } from "../platform/crypto";
import { parseJsonValue } from "../platform/values";

export async function listWebhookEndpoints(
  database: KaenmaDatabase,
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
  database: KaenmaDatabase,
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
