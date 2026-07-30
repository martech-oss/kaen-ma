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
import { subscriptionTopics } from "../consent/schema";
import { contacts, segments } from "../contacts/schema";

export const emailTemplates = sqliteTable(
  "email_templates",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    purpose: text().notNull(),
    resendTemplateId: text("resend_template_id").notNull(),
    resendAlias: text("resend_alias"),
    subject: text(),
    remoteStatus: text("remote_status").default("draft").notNull(),
    remoteCurrentVersionId: text("remote_current_version_id").notNull(),
    hasUnpublishedVersions: integer("has_unpublished_versions", { mode: "boolean" })
      .default(false)
      .notNull(),
    variables: text().default("[]").notNull(),
    publishedAt: text("published_at"),
    lastSyncedAt: text("last_synced_at").notNull(),
    syncError: text("sync_error"),
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
    uniqueIndex("email_templates_resend_template_unique").on(table.resendTemplateId),
    check("email_templates_purpose_check", sql`${table.purpose} IN ('transactional', 'marketing')`),
    check(
      "email_templates_remote_status_check",
      sql`${table.remoteStatus} IN ('draft', 'published')`,
    ),
  ],
);

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().default("").notNull(),
    status: text().default("draft").notNull(),
    draftVersionId: text("draft_version_id"),
    publishedVersionId: text("published_version_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("campaigns_workspace_status_updated_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    check(
      "campaigns_status_check",
      sql`${table.status} IN ('draft', 'active', 'paused', 'archived')`,
    ),
  ],
);

export const campaignVersions = sqliteTable(
  "campaign_versions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    status: text().default("draft").notNull(),
    timezone: text().default("UTC").notNull(),
    graph: text().notNull(),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("campaign_versions_workspace_campaign_version_unique").on(
      table.workspaceId,
      table.campaignId,
      table.version,
    ),
    check("campaign_versions_status_check", sql`${table.status} IN ('draft', 'published')`),
  ],
);

export const campaignTriggers = sqliteTable(
  "campaign_triggers",
  {
    campaignVersionId: text("campaign_version_id")
      .primaryKey()
      .notNull()
      .references(() => campaignVersions.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sourceNodeId: text("source_node_id").notNull(),
    source: text().notNull(),
    eventType: text("event_type"),
    resourceId: text("resource_id"),
    reentry: text().default("once").notNull(),
    inactivityDays: integer("inactivity_days"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("campaign_triggers_workspace_event_idx").on(
      table.workspaceId,
      table.eventType,
      table.resourceId,
    ),
    index("campaign_triggers_source_idx").on(table.source, table.workspaceId),
    check(
      "campaign_triggers_source_check",
      sql`${table.source} IN ('segment_joined', 'form_submitted', 'contact_created', 'api_event', 'webhook_event', 'contact_inactive')`,
    ),
    check("campaign_triggers_reentry_check", sql`${table.reentry} IN ('once', 'every_time')`),
  ],
);

export const campaignEnrollments = sqliteTable(
  "campaign_enrollments",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    campaignVersionId: text("campaign_version_id")
      .notNull()
      .references(() => campaignVersions.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    sourceEventId: text("source_event_id"),
    status: text().default("active").notNull(),
    currentNodeId: text("current_node_id"),
    enteredAt: text("entered_at").notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("campaign_enrollments_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index("campaign_enrollments_workspace_campaign_entered_idx").on(
      table.workspaceId,
      table.campaignId,
      table.enteredAt,
    ),
    index("campaign_enrollments_workspace_completed_idx").on(table.workspaceId, table.completedAt),
    uniqueIndex("campaign_enrollment_source_unique").on(
      table.workspaceId,
      table.campaignId,
      table.contactId,
      table.sourceEventId,
    ),
    check(
      "campaign_enrollments_status_check",
      sql`${table.status} IN ('active', 'completed', 'cancelled', 'failed')`,
    ),
  ],
);

export const campaignJobs = sqliteTable(
  "campaign_jobs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enrollmentId: text("enrollment_id")
      .notNull()
      .references(() => campaignEnrollments.id, { onDelete: "cascade" }),
    campaignVersionId: text("campaign_version_id")
      .notNull()
      .references(() => campaignVersions.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    recipientId: text("recipient_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: text().default("{}").notNull(),
    status: text().default("pending").notNull(),
    dueAt: text("due_at").notNull(),
    leaseId: text("lease_id"),
    leaseUntil: text("lease_until"),
    attempts: integer().default(0).notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("campaign_jobs_workspace_enrollment_idx").on(
      table.workspaceId,
      table.enrollmentId,
      table.createdAt,
    ),
    index("campaign_jobs_due_claim_idx").on(table.status, table.dueAt, table.leaseUntil),
    uniqueIndex("campaign_jobs_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    check(
      "campaign_jobs_status_check",
      sql`${table.status} IN ('pending', 'leased', 'queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
  ],
);

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

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    enrollmentId: text("enrollment_id").references(() => campaignEnrollments.id, {
      onDelete: "set null",
    }),
    broadcastId: text("broadcast_id").references(() => broadcasts.id, { onDelete: "set null" }),
    channel: text().notNull(),
    purpose: text().notNull(),
    provider: text().notNull(),
    recipient: text().notNull(),
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
    uniqueIndex("deliveries_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    check("deliveries_channel_check", sql`${table.channel} IN ('email', 'webhook')`),
    check("deliveries_purpose_check", sql`${table.purpose} IN ('transactional', 'marketing')`),
    check("deliveries_provider_check", sql`${table.provider} IN ('resend', 'webhook')`),
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
    check(
      "delivery_events_type_check",
      sql`${table.type} IN ('accepted', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'replied', 'failed')`,
    ),
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
