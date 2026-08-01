import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";

import type { WorkspaceContext } from "@kaenma/orpc";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { contacts } from "../contacts/schema";
import { deliveries } from "../messaging/schema";
import { uuidv7 } from "../shared/uuid";
import { contactSubscriptions, subscriptionTopics, suppressions } from "./schema";

export type SubscriptionTopicRecord = typeof subscriptionTopics.$inferSelect;

export type TopicCreateOutcome = { kind: "conflict" } | { kind: "created"; id: string };

/** The raw reads behind the pre-send consent gate, one row (or count) each. */
export interface ConsentGateRows {
  contactStatus: string | null;
  suppressionReason: string | null;
  topicStatus: string | null;
  marketingSentInWindow: number;
}

/**
 * Queries for subscription topics and consent state.
 *
 * Scoped by workspace id only (not the full {@link WorkspaceContext}), because
 * the delivery worker resolves just the workspace id from the delivery row.
 * A full context is assignable wherever this scope is expected.
 */
export class ConsentRepository {
  private readonly database: KaenmaDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: Pick<WorkspaceContext, "workspaceId">,
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

  /**
   * Loads everything the pre-send consent gate evaluates in one atomic D1
   * batch: contact status, any suppression (by contact or address), the topic
   * subscription, and the marketing sends of the trailing 24 hours. The
   * possibly-null contact and topic ids are compared as plain SQL templates so
   * a null binds NULL and simply matches nothing, exactly like the raw reads
   * this replaces.
   */
  public async readConsentGateRows(input: {
    contactId: string | null;
    recipient: string;
    topicId: string | null;
  }): Promise<ConsentGateRows> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [contactRows, suppressionRows, subscriptionRows, frequencyRows] = await orm.batch([
      orm
        .select({ status: contacts.status })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), sql`${contacts.id} = ${input.contactId}`))
        .limit(1),
      orm
        .select({ reason: suppressions.reason })
        .from(suppressions)
        .where(
          and(
            eq(suppressions.workspaceId, workspaceId),
            or(
              sql`${suppressions.contactId} = ${input.contactId}`,
              eq(suppressions.email, input.recipient),
            ),
          ),
        )
        .limit(1),
      orm
        .select({ status: contactSubscriptions.status })
        .from(contactSubscriptions)
        .where(
          and(
            eq(contactSubscriptions.workspaceId, workspaceId),
            sql`${contactSubscriptions.contactId} = ${input.contactId}`,
            sql`${contactSubscriptions.topicId} = ${input.topicId}`,
          ),
        ),
      orm
        .select({ count: count() })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.workspaceId, workspaceId),
            sql`${deliveries.contactId} = ${input.contactId}`,
            eq(deliveries.purpose, "marketing"),
            inArray(deliveries.status, ["accepted", "delivered"]),
            sql`${deliveries.createdAt} >= datetime('now', '-1 day')`,
          ),
        ),
    ]);
    return {
      contactStatus: contactRows[0]?.status ?? null,
      suppressionReason: suppressionRows[0]?.reason ?? null,
      topicStatus: subscriptionRows[0]?.status ?? null,
      marketingSentInWindow: frequencyRows[0]?.count ?? 0,
    };
  }
}
