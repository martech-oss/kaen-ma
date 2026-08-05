import { PROVIDERS, WORKSPACE_ROLES } from "@openengage/core/shared";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization, user } from "../auth/schema";
import { checkEnum } from "../shared/enum-check";

export const webhookEndpoints = sqliteTable(
  "webhook_endpoints",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    url: text().notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    eventTypes: text("event_types").default("[]").notNull(),
    enabled: integer({ mode: "boolean" }).default(true).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("webhook_endpoints_workspace_idx").on(table.workspaceId, table.enabled)],
);

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    payload: text().notNull(),
    status: text().default("pending").notNull(),
    httpStatus: integer("http_status"),
    attempts: integer().default(0).notNull(),
    nextAttemptAt: text("next_attempt_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("webhook_deliveries_retry_idx").on(table.status, table.nextAttemptAt),
    uniqueIndex("webhook_delivery_event_unique").on(
      table.workspaceId,
      table.endpointId,
      table.eventId,
    ),
  ],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    prefix: text().notNull(),
    keyHash: text("key_hash").notNull(),
    role: text().notNull(),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("api_keys_workspace_idx").on(table.workspaceId, table.revokedAt),
    uniqueIndex("api_keys_prefix_unique").on(table.prefix),
    checkEnum("api_keys_role_check", table.role, WORKSPACE_ROLES),
  ],
);

export const providerConfigs = sqliteTable(
  "provider_configs",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    name: text().notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    settings: text().default("{}").notNull(),
    enabled: integer({ mode: "boolean" }).default(true).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("provider_configs_workspace_provider_name_unique").on(
      table.workspaceId,
      table.provider,
      table.name,
    ),
    checkEnum("provider_configs_provider_check", table.provider, PROVIDERS),
  ],
);
