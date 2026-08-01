import { asc, eq } from "drizzle-orm";

import { subscriptionTopics, uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { SubscriptionTopicRow } from "@kaenma/orpc";

export async function listSubscriptionTopics(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<SubscriptionTopicRow[]> {
  const rows = await database.orm
    .select()
    .from(subscriptionTopics)
    .where(eq(subscriptionTopics.workspaceId, workspaceId))
    .orderBy(asc(subscriptionTopics.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isDefault: row.isDefault === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export type TopicCreateOutcome = { kind: "conflict" } | { kind: "created"; id: string };

export async function createSubscriptionTopic(
  database: KaenmaDatabase,
  workspaceId: string,
  input: { name: string; slug: string; description: string; isDefault: boolean },
): Promise<TopicCreateOutcome> {
  const id = uuidv7();
  const now = new Date().toISOString();
  try {
    await database.orm.insert(subscriptionTopics).values({
      id,
      workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      isDefault: input.isDefault ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    // The only constraint on this insert is unique(workspace_id, slug).
    return { kind: "conflict" };
  }
  return { kind: "created", id };
}
