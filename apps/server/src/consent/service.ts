import {
  ConsentRepository,
  type OpenEngageDatabase,
  type TopicCreateOutcome,
} from "@openengage/database";
import type { SubscriptionTopicRow, WorkspaceContext } from "@openengage/orpc";

export type { TopicCreateOutcome } from "@openengage/database";

export async function listSubscriptionTopics(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<SubscriptionTopicRow[]> {
  const rows = await new ConsentRepository(database, workspace).listTopics();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function createSubscriptionTopic(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { name: string; slug: string; description: string; isDefault: boolean },
): Promise<TopicCreateOutcome> {
  return new ConsentRepository(database, workspace).createTopic(input);
}
