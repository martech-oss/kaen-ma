import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization, user } from "./auth-schema";

export const companies = sqliteTable("companies", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	domain: text(),
	customFields: text("custom_fields").default("{}").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("companies_workspace_name_idx").on(table.workspaceId, table.name),
	uniqueIndex("companies_workspace_domain_unique").on(table.workspaceId, table.domain),
]);

export const contacts = sqliteTable("contacts", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	visitorId: text("visitor_id"),
	email: text(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	phone: text(),
	externalId: text("external_id"),
	stage: text().default("lead").notNull(),
	score: integer().default(0).notNull(),
	status: text().default("active").notNull(),
	customFields: text("custom_fields").default("{}").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
	archivedAt: text("archived_at"),
},
(table) => [
	index("contacts_workspace_status_updated_idx").on(table.workspaceId, table.status, table.updatedAt),
	index("contacts_workspace_stage_idx").on(table.workspaceId, table.stage),
	index("contacts_workspace_score_idx").on(table.workspaceId, table.score),
	index("contacts_workspace_created_idx").on(table.workspaceId, table.createdAt, table.id),
	uniqueIndex("contacts_workspace_visitor_unique").on(table.workspaceId, table.visitorId),
	uniqueIndex("contacts_workspace_external_unique").on(table.workspaceId, table.externalId),
	uniqueIndex("contacts_workspace_email_unique").on(table.workspaceId, table.email),
	check("contacts_status_check", sql`${table.status} IN ('active', 'archived', 'anonymous')`),
]);

export const companyContacts = sqliteTable("company_contacts", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	title: text(),
	isPrimary: integer("is_primary").default(0).notNull(),
	createdAt: text("created_at").notNull(),
},
(table) => [
	index("company_contacts_workspace_contact_idx").on(table.workspaceId, table.contactId),
	primaryKey({ columns: [table.workspaceId, table.companyId, table.contactId], name: "company_contacts_workspace_id_company_id_contact_id_pk"})
]);

export const customFieldDefinitions = sqliteTable("custom_field_definitions", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	entityType: text("entity_type").notNull(),
	key: text().notNull(),
	label: text().notNull(),
	dataType: text("data_type").notNull(),
	settings: text().default("{}").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	uniqueIndex("custom_fields_workspace_entity_key_unique").on(table.workspaceId, table.entityType, table.key),
	check("custom_fields_entity_type_check", sql`${table.entityType} IN ('contact', 'company')`),
	check("custom_fields_data_type_check", sql`${table.dataType} IN ('text', 'number', 'boolean', 'date', 'select')`),
]);

export const tags = sqliteTable("tags", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	slug: text().notNull(),
	color: text().default("#64748b").notNull(),
	createdAt: text("created_at").notNull(),
},
(table) => [
	uniqueIndex("tags_workspace_slug_unique").on(table.workspaceId, table.slug),
]);

export const contactTags = sqliteTable("contact_tags", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" } ),
	createdAt: text("created_at").notNull(),
},
(table) => [
	index("contact_tags_workspace_tag_idx").on(table.workspaceId, table.tagId, table.contactId),
	primaryKey({ columns: [table.workspaceId, table.contactId, table.tagId], name: "contact_tags_workspace_id_contact_id_tag_id_pk"})
]);

export const scoreEvents = sqliteTable("score_events", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	delta: integer().notNull(),
	total: integer().notNull(),
	reason: text().notNull(),
	campaignEnrollmentId: text("campaign_enrollment_id"),
	createdAt: text("created_at").notNull(),
},
(table) => [
	index("score_events_workspace_contact_idx").on(table.workspaceId, table.contactId, table.createdAt),
]);

export const segments = sqliteTable("segments", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	slug: text().notNull(),
	kind: text().notNull(),
	filterAst: text("filter_ast"),
	memberCount: integer("member_count").default(0).notNull(),
	evaluatedAt: text("evaluated_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("segments_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
	uniqueIndex("segments_workspace_slug_unique").on(table.workspaceId, table.slug),
	check("segments_kind_check", sql`${table.kind} IN ('static', 'dynamic')`),
]);

export const segmentMemberships = sqliteTable("segment_memberships", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	segmentId: text("segment_id").notNull().references(() => segments.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	source: text().notNull(),
	joinedAt: text("joined_at").notNull(),
},
(table) => [
	index("segment_memberships_workspace_contact_idx").on(table.workspaceId, table.contactId, table.segmentId),
	primaryKey({ columns: [table.workspaceId, table.segmentId, table.contactId], name: "segment_memberships_workspace_id_segment_id_contact_id_pk"}),
	check("segment_memberships_source_check", sql`${table.source} IN ('static', 'dynamic', 'campaign')`),
]);

export const subscriptionTopics = sqliteTable("subscription_topics", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	slug: text().notNull(),
	description: text().default("").notNull(),
	isDefault: integer("is_default").default(0).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	uniqueIndex("topics_workspace_slug_unique").on(table.workspaceId, table.slug),
]);

export const contactSubscriptions = sqliteTable("contact_subscriptions", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	topicId: text("topic_id").notNull().references(() => subscriptionTopics.id, { onDelete: "cascade" } ),
	status: text().notNull(),
	source: text().notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("contact_subscriptions_workspace_status_idx").on(table.workspaceId, table.topicId, table.status),
	primaryKey({ columns: [table.workspaceId, table.contactId, table.topicId], name: "contact_subscriptions_workspace_id_contact_id_topic_id_pk"}),
	check("contact_subscriptions_status_check", sql`${table.status} IN ('subscribed', 'unsubscribed', 'pending')`),
]);

export const consentEvents = sqliteTable("consent_events", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	topicId: text("topic_id").references(() => subscriptionTopics.id, { onDelete: "set null" } ),
	action: text().notNull(),
	source: text().notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	proof: text().default("{}").notNull(),
	createdAt: text("created_at").notNull(),
},
(table) => [
	index("consent_events_workspace_contact_idx").on(table.workspaceId, table.contactId, table.createdAt),
	check("consent_events_action_check", sql`${table.action} IN ('granted', 'revoked', 'confirmed', 'unsubscribed')`),
]);

export const suppressions = sqliteTable("suppressions", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" } ),
	email: text(),
	reason: text().notNull(),
	provider: text(),
	createdAt: text("created_at").notNull(),
},
(table) => [
	index("suppressions_workspace_contact_idx").on(table.workspaceId, table.contactId),
	uniqueIndex("suppressions_workspace_email_unique").on(table.workspaceId, table.email),
	check("suppressions_reason_check", sql`${table.reason} IN ('global_unsubscribe', 'bounce', 'complaint', 'manual')`),
	check("suppressions_target_check", sql`${table.contactId} IS NOT NULL OR ${table.email} IS NOT NULL`),
]);

export const projects = sqliteTable("projects", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	description: text().default("").notNull(),
	color: text().default("#7c3aed").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("projects_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
]);

export const projectItems = sqliteTable("project_items", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" } ),
	resourceType: text("resource_type").notNull(),
	resourceId: text("resource_id").notNull(),
	createdAt: text("created_at").notNull(),
},
(table) => [
	primaryKey({ columns: [table.workspaceId, table.projectId, table.resourceType, table.resourceId], name: "project_items_workspace_id_project_id_resource_type_resource_id_pk"}),
	check("project_items_resource_type_check", sql`${table.resourceType} IN ('campaign', 'email', 'form', 'page', 'segment')`),
]);

export const assets = sqliteTable("assets", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
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
]);

export const emailTemplates = sqliteTable("email_templates", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	purpose: text().notNull(),
	status: text().default("draft").notNull(),
	currentVersionId: text("current_version_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("email_templates_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
	check("email_templates_purpose_check", sql`${table.purpose} IN ('transactional', 'marketing')`),
	check("email_templates_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
]);

export const emailTemplateVersions = sqliteTable("email_template_versions", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	templateId: text("template_id").notNull().references(() => emailTemplates.id, { onDelete: "cascade" } ),
	version: integer().notNull(),
	subject: text().notNull(),
	previewText: text("preview_text").default("").notNull(),
	contentDocument: text("content_document").notNull(),
	html: text(),
	text: text(),
	publishedAt: text("published_at"),
	createdAt: text("created_at").notNull(),
},
(table) => [
	uniqueIndex("email_versions_workspace_template_version_unique").on(table.workspaceId, table.templateId, table.version),
]);

export const forms = sqliteTable("forms", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
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
]);

export const formSubmissions = sqliteTable("form_submissions", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	formId: text("form_id").notNull().references(() => forms.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" } ),
	idempotencyKey: text("idempotency_key").notNull(),
	payload: text().notNull(),
	ipHash: text("ip_hash"),
	createdAt: text("created_at").notNull(),
},
(table) => [
	index("form_submissions_workspace_form_created_idx").on(table.workspaceId, table.formId, table.createdAt),
	uniqueIndex("form_submissions_workspace_idempotency_unique").on(table.workspaceId, table.formId, table.idempotencyKey),
]);

export const landingPages = sqliteTable("landing_pages", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
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
]);

export const landingPageVersions = sqliteTable("landing_page_versions", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	pageId: text("page_id").notNull().references(() => landingPages.id, { onDelete: "cascade" } ),
	version: integer().notNull(),
	contentDocument: text("content_document").notNull(),
	publishedAt: text("published_at"),
	createdAt: text("created_at").notNull(),
},
(table) => [
	uniqueIndex("page_versions_workspace_page_version_unique").on(table.workspaceId, table.pageId, table.version),
]);

export const campaigns = sqliteTable("campaigns", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	description: text().default("").notNull(),
	status: text().default("draft").notNull(),
	draftVersionId: text("draft_version_id"),
	publishedVersionId: text("published_version_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("campaigns_workspace_status_updated_idx").on(table.workspaceId, table.status, table.updatedAt),
	check("campaigns_status_check", sql`${table.status} IN ('draft', 'active', 'paused', 'archived')`),
]);

export const campaignVersions = sqliteTable("campaign_versions", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" } ),
	version: integer().notNull(),
	status: text().default("draft").notNull(),
	timezone: text().default("UTC").notNull(),
	graph: text().notNull(),
	publishedAt: text("published_at"),
	createdAt: text("created_at").notNull(),
},
(table) => [
	uniqueIndex("campaign_versions_workspace_campaign_version_unique").on(table.workspaceId, table.campaignId, table.version),
	check("campaign_versions_status_check", sql`${table.status} IN ('draft', 'published')`),
]);

export const campaignEnrollments = sqliteTable("campaign_enrollments", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" } ),
	campaignVersionId: text("campaign_version_id").notNull().references(() => campaignVersions.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	sourceEventId: text("source_event_id"),
	status: text().default("active").notNull(),
	currentNodeId: text("current_node_id"),
	enteredAt: text("entered_at").notNull(),
	completedAt: text("completed_at"),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("campaign_enrollments_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
	uniqueIndex("campaign_enrollment_source_unique").on(table.workspaceId, table.campaignVersionId, table.contactId, table.sourceEventId),
	check("campaign_enrollments_status_check", sql`${table.status} IN ('active', 'completed', 'cancelled', 'failed')`),
]);

export const campaignJobs = sqliteTable("campaign_jobs", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	enrollmentId: text("enrollment_id").notNull().references(() => campaignEnrollments.id, { onDelete: "cascade" } ),
	campaignVersionId: text("campaign_version_id").notNull().references(() => campaignVersions.id, { onDelete: "cascade" } ),
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
	index("campaign_jobs_workspace_enrollment_idx").on(table.workspaceId, table.enrollmentId, table.createdAt),
	index("campaign_jobs_due_claim_idx").on(table.status, table.dueAt, table.leaseUntil),
	uniqueIndex("campaign_jobs_workspace_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
	check("campaign_jobs_status_check", sql`${table.status} IN ('pending', 'leased', 'queued', 'running', 'succeeded', 'failed', 'cancelled')`),
]);

export const broadcasts = sqliteTable("broadcasts", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	segmentId: text("segment_id").notNull().references(() => segments.id, { onDelete: "restrict" } ),
	templateVersionId: text("template_version_id").notNull().references(() => emailTemplateVersions.id, { onDelete: "restrict" } ),
	topicId: text("topic_id").references(() => subscriptionTopics.id, { onDelete: "restrict" } ),
	status: text().default("draft").notNull(),
	scheduledAt: text("scheduled_at"),
	startedAt: text("started_at"),
	completedAt: text("completed_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
	archivedAt: text("archived_at"),
},
(table) => [
	index("broadcasts_workspace_archived_updated_idx").on(table.workspaceId, table.archivedAt, table.updatedAt),
	index("broadcasts_workspace_status_idx").on(table.workspaceId, table.status, table.scheduledAt),
	check("broadcasts_status_check", sql`${table.status} IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled')`),
]);

export const broadcastRecipients = sqliteTable("broadcast_recipients", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	broadcastId: text("broadcast_id").notNull().references(() => broadcasts.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	status: text().default("pending").notNull(),
	snapshotAt: text("snapshot_at").notNull(),
},
(table) => [
	index("broadcast_recipients_status_idx").on(table.workspaceId, table.broadcastId, table.status),
	primaryKey({ columns: [table.workspaceId, table.broadcastId, table.contactId], name: "broadcast_recipients_workspace_id_broadcast_id_contact_id_pk"})
]);

export const deliveryEvents = sqliteTable("delivery_events", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	deliveryId: text("delivery_id").notNull().references(() => deliveries.id, { onDelete: "cascade" } ),
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
	index("delivery_events_workspace_delivery_idx").on(table.workspaceId, table.deliveryId, table.occurredAt),
	index("delivery_events_workspace_occurred_idx").on(table.workspaceId, table.occurredAt),
	uniqueIndex("delivery_events_provider_event_unique").on(table.workspaceId, table.provider, table.providerEventId),
	check("delivery_events_type_check", sql`${table.type} IN ('accepted', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'replied', 'failed')`),
]);

export const contactEvents = sqliteTable("contact_events", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" } ),
	visitorId: text("visitor_id"),
	type: text().notNull(),
	resourceType: text("resource_type"),
	resourceId: text("resource_id"),
	properties: text().default("{}").notNull(),
	occurredAt: text("occurred_at").notNull(),
	archivedAt: text("archived_at"),
	createdAt: text("created_at").notNull(),
},
(table) => [
	index("contact_events_workspace_visitor_idx").on(table.workspaceId, table.visitorId, table.occurredAt),
	index("contact_events_workspace_type_occurred_idx").on(table.workspaceId, table.type, table.occurredAt),
	index("contact_events_workspace_contact_idx").on(table.workspaceId, table.contactId, table.occurredAt),
]);

export const webhookEndpoints = sqliteTable("webhook_endpoints", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	url: text().notNull(),
	encryptedSecret: text("encrypted_secret").notNull(),
	eventTypes: text("event_types").default("[]").notNull(),
	enabled: integer().default(1).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("webhook_endpoints_workspace_idx").on(table.workspaceId, table.enabled),
]);

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	endpointId: text("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" } ),
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
	uniqueIndex("webhook_delivery_event_unique").on(table.workspaceId, table.endpointId, table.eventId),
]);

export const inboundEmails = sqliteTable("inbound_emails", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" } ),
	deliveryId: text("delivery_id").references(() => deliveries.id, { onDelete: "set null" } ),
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
	index("inbound_emails_workspace_contact_idx").on(table.workspaceId, table.contactId, table.receivedAt),
]);

export const apiKeys = sqliteTable("api_keys", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "cascade" } ),
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
	check("api_keys_role_check", sql`${table.role} IN ('owner', 'admin', 'marketer', 'analyst', 'viewer')`),
]);

export const idempotencyKeys = sqliteTable("idempotency_keys", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	scope: text().notNull(),
	idempotencyKey: text("idempotency_key").notNull(),
	responseStatus: integer("response_status"),
	responseBody: text("response_body"),
	createdAt: text("created_at").notNull(),
	expiresAt: text("expires_at").notNull(),
},
(table) => [
	index("idempotency_keys_expiry_idx").on(table.expiresAt),
	primaryKey({ columns: [table.workspaceId, table.scope, table.idempotencyKey], name: "idempotency_keys_workspace_id_scope_idempotency_key_pk"})
]);

export const deadLetters = sqliteTable("dead_letters", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").references(() => organization.id, { onDelete: "cascade" } ),
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
	check("dead_letters_status_check", sql`${table.status} IN ('pending', 'replayed', 'discarded')`),
]);

export const auditLogs = sqliteTable("audit_logs", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" } ),
	apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" } ),
	action: text().notNull(),
	resourceType: text("resource_type").notNull(),
	resourceId: text("resource_id"),
	metadata: text().default("{}").notNull(),
	ipAddress: text("ip_address"),
	createdAt: text("created_at").notNull(),
},
(table) => [
	index("audit_logs_workspace_resource_idx").on(table.workspaceId, table.resourceType, table.resourceId),
	index("audit_logs_workspace_created_idx").on(table.workspaceId, table.createdAt),
]);

export const dailyMetrics = sqliteTable("daily_metrics", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
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
	primaryKey({ columns: [table.workspaceId, table.metricDate, table.dimensionType, table.dimensionId], name: "daily_metrics_workspace_id_metric_date_dimension_type_dimension_id_pk"})
]);

export const importJobs = sqliteTable("import_jobs", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
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
	check("import_jobs_kind_check", sql`${table.kind} IN ('contact_import', 'contact_export', 'event_archive')`),
]);

export const deliveries = sqliteTable("deliveries", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" } ),
	enrollmentId: text("enrollment_id").references(() => campaignEnrollments.id, { onDelete: "set null" } ),
	broadcastId: text("broadcast_id").references(() => broadcasts.id, { onDelete: "set null" } ),
	channel: text().notNull(),
	purpose: text().notNull(),
	provider: text().notNull(),
	recipient: text().notNull(),
	topicId: text("topic_id").references(() => subscriptionTopics.id, { onDelete: "set null" } ),
	templateVersionId: text("template_version_id").references(() => emailTemplateVersions.id, { onDelete: "set null" } ),
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
	index("deliveries_workspace_contact_created_idx").on(table.workspaceId, table.contactId, table.createdAt),
	index("deliveries_workspace_status_next_idx").on(table.workspaceId, table.status, table.nextAttemptAt),
	uniqueIndex("deliveries_workspace_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
	check("deliveries_channel_check", sql`${table.channel} IN ('email', 'webhook')`),
	check("deliveries_purpose_check", sql`${table.purpose} IN ('transactional', 'marketing')`),
	check("deliveries_provider_check", sql`${table.provider} IN ('cloudflare', 'postmark', 'resend', 'webhook')`),
	check("deliveries_status_check", sql`${table.status} IN ('queued', 'sending', 'accepted', 'delivered', 'failed', 'suppressed', 'cancelled')`),
]);

export const providerConfigs = sqliteTable("provider_configs", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
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
	uniqueIndex("provider_configs_workspace_provider_name_unique").on(table.workspaceId, table.provider, table.name),
	check("provider_configs_provider_check", sql`${table.provider} IN ('cloudflare', 'postmark', 'resend', 'webhook')`),
]);

export const contactLists = sqliteTable("contact_lists", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	slug: text().notNull(),
	description: text().default("").notNull(),
	color: text().default("#6366f1").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("contact_lists_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
	uniqueIndex("contact_lists_workspace_slug_unique").on(table.workspaceId, table.slug),
]);

export const contactListMemberships = sqliteTable("contact_list_memberships", {
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	listId: text("list_id").notNull().references(() => contactLists.id, { onDelete: "cascade" } ),
	contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" } ),
	status: text().default("active").notNull(),
	source: text().default("manual").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("contact_list_memberships_workspace_list_status_idx").on(table.workspaceId, table.listId, table.status, table.contactId),
	index("contact_list_memberships_workspace_contact_idx").on(table.workspaceId, table.contactId, table.listId),
	primaryKey({ columns: [table.workspaceId, table.listId, table.contactId], name: "contact_list_memberships_workspace_id_list_id_contact_id_pk"}),
	check("contact_list_memberships_status_check", sql`${table.status} IN ('active', 'unsubscribed')`),
]);

export const messageVariables = sqliteTable("message_variables", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
	key: text().notNull(),
	name: text().notNull(),
	value: text().notNull(),
	description: text().default("").notNull(),
	archivedAt: text("archived_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	index("message_variables_workspace_archived_updated_idx").on(table.workspaceId, table.archivedAt, table.updatedAt),
	uniqueIndex("message_variables_workspace_key_unique").on(table.workspaceId, table.key),
]);

export const siteTrackingSettings = sqliteTable("site_tracking_settings", {
	workspaceId: text("workspace_id").primaryKey().notNull().references(() => organization.id, { onDelete: "cascade" } ),
	enabled: integer().default(0).notNull(),
	allowedDomains: text("allowed_domains").default("[]").notNull(),
	consentMode: text("consent_mode").default("required").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => [
	check("site_tracking_settings_consent_mode_check", sql`${table.consentMode} IN ('required')`),
]);

export const siteMessages = sqliteTable("site_messages", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" } ),
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
	index("site_messages_workspace_schedule_idx").on(table.workspaceId, table.startsAt, table.endsAt),
	index("site_messages_workspace_status_updated_idx").on(table.workspaceId, table.status, table.updatedAt),
	check("site_messages_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
]);
