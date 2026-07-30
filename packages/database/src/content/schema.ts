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

export const projects = sqliteTable(
  "projects",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().default("").notNull(),
    color: text().default("#7c3aed").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("projects_workspace_updated_idx").on(table.workspaceId, table.updatedAt)],
);

export const projectItems = sqliteTable(
  "project_items",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.projectId, table.resourceType, table.resourceId],
      name: "project_items_workspace_id_project_id_resource_type_resource_id_pk",
    }),
    check(
      "project_items_resource_type_check",
      sql`${table.resourceType} IN ('campaign', 'email', 'form', 'page', 'segment')`,
    ),
  ],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer().notNull(),
    checksum: text().notNull(),
    visibility: text().default("private").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assets_workspace_created_idx").on(table.workspaceId, table.createdAt),
    uniqueIndex("assets_workspace_key_unique").on(table.workspaceId, table.r2Key),
    check("assets_visibility_check", sql`${table.visibility} IN ('public', 'private')`),
  ],
);

export const forms = sqliteTable(
  "forms",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    status: text().default("draft").notNull(),
    version: integer().default(1).notNull(),
    definition: text().notNull(),
    allowedDomains: text("allowed_domains").default("[]").notNull(),
    turnstileEnabled: integer("turnstile_enabled").default(1).notNull(),
    successMessage: text("success_message").default("ありがとうございます。").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("forms_workspace_slug_unique").on(table.workspaceId, table.slug),
    check("forms_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  ],
);

export const formSubmissions = sqliteTable(
  "form_submissions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: text().notNull(),
    ipHash: text("ip_hash"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("form_submissions_workspace_form_created_idx").on(
      table.workspaceId,
      table.formId,
      table.createdAt,
    ),
    index("form_submissions_workspace_created_idx").on(table.workspaceId, table.createdAt),
    uniqueIndex("form_submissions_workspace_idempotency_unique").on(
      table.workspaceId,
      table.formId,
      table.idempotencyKey,
    ),
  ],
);

export const landingPages = sqliteTable(
  "landing_pages",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    status: text().default("draft").notNull(),
    currentVersionId: text("current_version_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("pages_workspace_slug_unique").on(table.workspaceId, table.slug),
    check("landing_pages_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  ],
);

export const landingPageVersions = sqliteTable(
  "landing_page_versions",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => landingPages.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    contentDocument: text("content_document").notNull(),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("page_versions_workspace_page_version_unique").on(
      table.workspaceId,
      table.pageId,
      table.version,
    ),
  ],
);
