import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";
import { contacts } from "../contacts/schema";

export const subscriptionTopics = sqliteTable(
  "subscription_topics",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    description: text().default("").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).default(false).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("subscription_topics_workspace_slug_unique").on(table.workspaceId, table.slug),
  ],
);

export const contactSubscriptions = sqliteTable(
  "contact_subscriptions",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => subscriptionTopics.id, { onDelete: "cascade" }),
    status: text().notNull(),
    source: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("contact_subscriptions_workspace_status_idx").on(
      table.workspaceId,
      table.topicId,
      table.status,
    ),
    primaryKey({
      columns: [table.workspaceId, table.contactId, table.topicId],
      name: "contact_subscriptions_workspace_id_contact_id_topic_id_pk",
    }),
    check(
      "contact_subscriptions_status_check",
      sql`${table.status} IN ('subscribed', 'unsubscribed', 'pending')`,
    ),
  ],
);

export const consentEvents = sqliteTable(
  "consent_events",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    topicId: text("topic_id").references(() => subscriptionTopics.id, { onDelete: "set null" }),
    action: text().notNull(),
    source: text().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    proof: text().default("{}").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("consent_events_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
      table.createdAt,
    ),
    check(
      "consent_events_action_check",
      sql`${table.action} IN ('granted', 'revoked', 'confirmed', 'unsubscribed')`,
    ),
  ],
);

export const suppressions = sqliteTable(
  "suppressions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    email: text(),
    reason: text().notNull(),
    provider: text(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("suppressions_workspace_contact_idx").on(table.workspaceId, table.contactId),
    uniqueIndex("suppressions_workspace_email_unique")
      .on(table.workspaceId, table.email)
      .where(sql`${table.email} IS NOT NULL`),
    check(
      "suppressions_reason_check",
      sql`${table.reason} IN ('global_unsubscribe', 'bounce', 'complaint', 'provider', 'manual')`,
    ),
    check(
      "suppressions_target_check",
      sql`${table.contactId} IS NOT NULL OR ${table.email} IS NOT NULL`,
    ),
  ],
);
