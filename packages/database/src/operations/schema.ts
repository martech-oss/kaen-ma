import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { organization, user } from "../auth/schema";
import { apiKeys } from "../integrations/schema";

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: text().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
    primaryKey({
      columns: [table.workspaceId, table.scope, table.idempotencyKey],
      name: "idempotency_keys_workspace_id_scope_idempotency_key_pk",
    }),
  ],
);

export const deadLetters = sqliteTable(
  "dead_letters",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id").references(() => organization.id, { onDelete: "cascade" }),
    sourceQueue: text("source_queue").notNull(),
    messageBody: text("message_body").notNull(),
    error: text().notNull(),
    attempts: integer().notNull(),
    status: text().default("pending").notNull(),
    createdAt: text("created_at").notNull(),
    replayedAt: text("replayed_at"),
  },
  (table) => [
    index("dead_letters_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    check(
      "dead_letters_status_check",
      sql`${table.status} IN ('pending', 'replayed', 'discarded')`,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    action: text().notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: text().default("{}").notNull(),
    ipAddress: text("ip_address"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_workspace_resource_idx").on(
      table.workspaceId,
      table.resourceType,
      table.resourceId,
    ),
    index("audit_logs_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const dailyMetrics = sqliteTable(
  "daily_metrics",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    metricDate: text("metric_date").notNull(),
    dimensionType: text("dimension_type").notNull(),
    dimensionId: text("dimension_id").notNull(),
    accepted: integer().default(0).notNull(),
    delivered: integer().default(0).notNull(),
    opened: integer().default(0).notNull(),
    clicked: integer().default(0).notNull(),
    bounced: integer().default(0).notNull(),
    complained: integer().default(0).notNull(),
    unsubscribed: integer().default(0).notNull(),
    failed: integer().default(0).notNull(),
  },
  (table) => [
    index("daily_metrics_workspace_date_idx").on(table.workspaceId, table.metricDate),
    primaryKey({
      columns: [table.workspaceId, table.metricDate, table.dimensionType, table.dimensionId],
      name: "daily_metrics_workspace_id_metric_date_dimension_type_dimension_id_pk",
    }),
  ],
);

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    r2Key: text("r2_key").notNull(),
    status: text().default("pending").notNull(),
    cursor: text(),
    processed: integer().default(0).notNull(),
    succeeded: integer().default(0).notNull(),
    failed: integer().default(0).notNull(),
    errorManifestKey: text("error_manifest_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("import_jobs_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    check(
      "import_jobs_kind_check",
      sql`${table.kind} IN ('contact_import', 'contact_export', 'event_archive')`,
    ),
  ],
);
