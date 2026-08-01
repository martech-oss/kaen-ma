import { sql } from "drizzle-orm";
import { check, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";
import { subscriptionTopics } from "../consent/schema";
import { contacts } from "../contacts/schema";
import { emailTemplates } from "../messaging/schema";
import { segments } from "../segments/schema";

export const broadcasts = sqliteTable(
  "broadcasts",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    segmentId: text("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "restrict" }),
    templateId: text("template_id")
      .notNull()
      .references(() => emailTemplates.id, { onDelete: "restrict" }),
    topicId: text("topic_id").references(() => subscriptionTopics.id, { onDelete: "restrict" }),
    status: text().default("draft").notNull(),
    scheduledAt: text("scheduled_at"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("broadcasts_workspace_archived_updated_idx").on(
      table.workspaceId,
      table.archivedAt,
      table.updatedAt,
    ),
    index("broadcasts_workspace_status_idx").on(table.workspaceId, table.status, table.scheduledAt),
    check(
      "broadcasts_status_check",
      sql`${table.status} IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled')`,
    ),
  ],
);

export const broadcastRecipients = sqliteTable(
  "broadcast_recipients",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    broadcastId: text("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: text().default("pending").notNull(),
    snapshotAt: text("snapshot_at").notNull(),
  },
  (table) => [
    index("broadcast_recipients_status_idx").on(table.workspaceId, table.broadcastId, table.status),
    primaryKey({
      columns: [table.workspaceId, table.broadcastId, table.contactId],
      name: "broadcast_recipients_workspace_id_broadcast_id_contact_id_pk",
    }),
  ],
);
