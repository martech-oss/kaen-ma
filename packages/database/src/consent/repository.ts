import { asc, eq } from "drizzle-orm";

import type { WorkspaceContext } from "@kaenma/orpc";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { uuidv7 } from "../shared/uuid";
import { subscriptionTopics } from "./schema";

export type SubscriptionTopicRecord = typeof subscriptionTopics.$inferSelect;

export type TopicCreateOutcome = { kind: "conflict" } | { kind: "created"; id: string };

export class ConsentRepository {
  private readonly database: KaenmaDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: WorkspaceContext,
  ) {
    this.database = createDatabase(database);
  }

  public async listTopics(): Promise<SubscriptionTopicRecord[]> {
    return await this.database.orm
      .select()
      .from(subscriptionTopics)
      .where(eq(subscriptionTopics.workspaceId, this.context.workspaceId))
      .orderBy(asc(subscriptionTopics.name));
  }

  public async createTopic(input: {
    name: string;
    slug: string;
    description: string;
    isDefault: boolean;
  }): Promise<TopicCreateOutcome> {
    const id = uuidv7();
    const now = new Date().toISOString();
    try {
      await this.database.orm.insert(subscriptionTopics).values({
        id,
        workspaceId: this.context.workspaceId,
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
}
