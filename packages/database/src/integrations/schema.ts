import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization, user } from "../auth/schema";
import { deliveries } from "../campaigns/schema";
import { contacts } from "../contacts/schema";

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
    enabled: integer().default(1).notNull(),
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
    check(
      "api_keys_role_check",
      sql`${table.role} IN ('owner', 'admin', 'marketer', 'analyst', 'viewer')`,
    ),
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
    enabled: integer().default(1).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("provider_configs_workspace_provider_name_unique").on(
      table.workspaceId,
      table.provider,
      table.name,
    ),
    check(
      "provider_configs_provider_check",
      sql`${table.provider} IN ('cloudflare', 'postmark', 'resend', 'webhook')`,
    ),
  ],
);
