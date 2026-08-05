import { CHANNELS, DELIVERY_EVENT_TYPES, MESSAGE_PURPOSES, PROVIDERS } from "@openengage/orpc";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";
import { automationEnrollments } from "../automations/schema";
import { broadcasts } from "../broadcasts/schema";
import { subscriptionTopics } from "../consent/schema";
import { contacts } from "../contacts/schema";
import { checkEnum } from "../shared/enum-check";

export const emailTemplates = sqliteTable(
  "email_templates",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    purpose: text().notNull(),
    draftSubject: text("draft_subject").notNull(),
    draftContent: text("draft_content").notNull(),
    draftRevision: integer("draft_revision").default(1).notNull(),
    publishedSubject: text("published_subject"),
    publishedContent: text("published_content"),
    publishedRevision: integer("published_revision"),
    publishedAt: text("published_at"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("email_templates_workspace_archived_updated_idx").on(
      table.workspaceId,
      table.archivedAt,
      table.updatedAt,
    ),
    checkEnum("email_templates_purpose_check", table.purpose, MESSAGE_PURPOSES),
  ],
);

export const messageVariables = sqliteTable(
  "message_variables",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    value: text().notNull(),
    description: text().default("").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("message_variables_workspace_archived_updated_idx").on(
      table.workspaceId,
      table.archivedAt,
      table.updatedAt,
    ),
    uniqueIndex("message_variables_workspace_key_unique").on(table.workspaceId, table.key),
  ],
);

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    enrollmentId: text("enrollment_id").references(() => automationEnrollments.id, {
      onDelete: "set null",
    }),
    broadcastId: text("broadcast_id").references(() => broadcasts.id, { onDelete: "set null" }),
    channel: text().notNull(),
    purpose: text().notNull(),
    provider: text().notNull(),
    // Nulled out when the owning contact is archived (see ContactRepository.
    // archiveContact / ContactResourceRepository.bulkSetContactsArchived) -
    // deliveries are kept for audit/reporting, but the PII they carried
    // independently of contactId (which is already SET NULL on delete)
    // shouldn't outlive the contact's own retention.
    recipient: text(),
    topicId: text("topic_id").references(() => subscriptionTopics.id, { onDelete: "set null" }),
    templateId: text("template_id").references(() => emailTemplates.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: text().notNull(),
    status: text().default("queued").notNull(),
    providerMessageId: text("provider_message_id"),
    attempts: integer().default(0).notNull(),
    nextAttemptAt: text("next_attempt_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("deliveries_workspace_contact_created_idx").on(
      table.workspaceId,
      table.contactId,
      table.createdAt,
    ),
    index("deliveries_workspace_status_next_idx").on(
      table.workspaceId,
      table.status,
      table.nextAttemptAt,
    ),
    index("deliveries_workspace_channel_created_idx").on(
      table.workspaceId,
      table.channel,
      table.createdAt,
    ),
    index("deliveries_provider_message_idx").on(table.provider, table.providerMessageId),
    uniqueIndex("deliveries_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    checkEnum("deliveries_channel_check", table.channel, CHANNELS),
    checkEnum("deliveries_purpose_check", table.purpose, MESSAGE_PURPOSES),
    checkEnum("deliveries_provider_check", table.provider, PROVIDERS),
    check(
      "deliveries_status_check",
      sql`${table.status} IN ('queued', 'sending', 'accepted', 'delivered', 'failed', 'suppressed', 'cancelled')`,
    ),
  ],
);

export const deliveryEvents = sqliteTable(
  "delivery_events",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    providerEventId: text("provider_event_id").notNull(),
    providerMessageId: text("provider_message_id"),
    type: text().notNull(),
    occurredAt: text("occurred_at").notNull(),
    metadata: text().default("{}").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("delivery_events_workspace_delivery_idx").on(
      table.workspaceId,
      table.deliveryId,
      table.occurredAt,
    ),
    index("delivery_events_workspace_occurred_idx").on(table.workspaceId, table.occurredAt),
    uniqueIndex("delivery_events_provider_event_unique").on(
      table.workspaceId,
      table.provider,
      table.providerEventId,
    ),
    checkEnum("delivery_events_type_check", table.type, DELIVERY_EVENT_TYPES),
  ],
);

export const inboundEmails = sqliteTable(
  "inbound_emails",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    deliveryId: text("delivery_id").references(() => deliveries.id, { onDelete: "set null" }),
    messageId: text("message_id"),
    sender: text().notNull(),
    recipient: text().notNull(),
    subject: text(),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    attachmentManifest: text("attachment_manifest").default("[]").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    index("inbound_emails_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
      table.receivedAt,
    ),
  ],
);
