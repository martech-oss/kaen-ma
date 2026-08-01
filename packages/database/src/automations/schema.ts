import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";
import { contacts } from "../contacts/schema";

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
