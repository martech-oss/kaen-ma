import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";

export const siteTrackingSettings = sqliteTable(
  "site_tracking_settings",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: integer().default(0).notNull(),
    allowedDomains: text("allowed_domains").default("[]").notNull(),
    consentMode: text("consent_mode").default("required").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("site_tracking_settings_consent_mode_check", sql`${table.consentMode} IN ('required')`),
  ],
);

export const siteMessages = sqliteTable(
  "site_messages",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    status: text().default("draft").notNull(),
    headline: text().notNull(),
    body: text().default("").notNull(),
    ctaLabel: text("cta_label").default("").notNull(),
    ctaUrl: text("cta_url"),
    pagePattern: text("page_pattern").default("*").notNull(),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    impressionCount: integer("impression_count").default(0).notNull(),
    clickCount: integer("click_count").default(0).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("site_messages_workspace_schedule_idx").on(
      table.workspaceId,
      table.startsAt,
      table.endsAt,
    ),
    index("site_messages_workspace_status_updated_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    check("site_messages_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  ],
);
