CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_unique` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`inviter_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_org_email_idx` ON `invitation` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX `invitation_inviter_idx` ON `invitation` (`inviter_id`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_role_check" CHECK("member"."role" IN ('owner', 'admin', 'marketer', 'analyst', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_org_user_unique` ON `member` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `member_user_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text,
	`timezone` text DEFAULT 'UTC' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `twoFactor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`failed_verification_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_secret_idx` ON `twoFactor` (`secret`);--> statement-breakpoint
CREATE INDEX `two_factor_user_idx` ON `twoFactor` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`two_factor_enabled` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `companies_workspace_name_idx` ON `companies` (`workspace_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `companies_workspace_domain_unique` ON `companies` (`workspace_id`,`domain`) WHERE "companies"."domain" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `company_contacts` (
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`title` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `company_id`, `contact_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `company_contacts_workspace_contact_idx` ON `company_contacts` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `contact_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text,
	`visitor_id` text,
	`type` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`properties` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contact_events_workspace_visitor_idx` ON `contact_events` (`workspace_id`,`visitor_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `contact_events_workspace_type_occurred_idx` ON `contact_events` (`workspace_id`,`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `contact_events_workspace_contact_idx` ON `contact_events` (`workspace_id`,`contact_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `contact_tags` (
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `contact_id`, `tag_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_tags_workspace_tag_idx` ON `contact_tags` (`workspace_id`,`tag_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`visitor_id` text,
	`email` text,
	`first_name` text,
	`last_name` text,
	`phone` text,
	`external_id` text,
	`stage` text DEFAULT 'lead' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contacts_status_check" CHECK("contacts"."status" IN ('active', 'archived', 'anonymous'))
);
--> statement-breakpoint
CREATE INDEX `contacts_workspace_status_updated_idx` ON `contacts` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `contacts_workspace_stage_idx` ON `contacts` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `contacts_workspace_score_idx` ON `contacts` (`workspace_id`,`score`);--> statement-breakpoint
CREATE INDEX `contacts_workspace_created_idx` ON `contacts` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_workspace_visitor_unique` ON `contacts` (`workspace_id`,`visitor_id`) WHERE "contacts"."visitor_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_workspace_external_unique` ON `contacts` (`workspace_id`,`external_id`) WHERE "contacts"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_workspace_email_unique` ON `contacts` (`workspace_id`,`email`) WHERE "contacts"."email" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `custom_field_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`data_type` text NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "custom_field_definitions_entity_type_check" CHECK("custom_field_definitions"."entity_type" IN ('contact', 'company')),
	CONSTRAINT "custom_field_definitions_data_type_check" CHECK("custom_field_definitions"."data_type" IN ('text', 'number', 'boolean', 'date', 'select'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_definitions_workspace_entity_key_unique` ON `custom_field_definitions` (`workspace_id`,`entity_type`,`key`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`r2_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cursor` text,
	`processed` integer DEFAULT 0 NOT NULL,
	`succeeded` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error_manifest_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "import_jobs_kind_check" CHECK("import_jobs"."kind" IN ('contact_import', 'contact_export', 'event_archive'))
);
--> statement-breakpoint
CREATE INDEX `import_jobs_workspace_status_idx` ON `import_jobs` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `score_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`automation_enrollment_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_enrollment_id`) REFERENCES `automation_enrollments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `score_events_workspace_contact_idx` ON `score_events` (`workspace_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_workspace_slug_unique` ON `tags` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `segment_memberships` (
	`workspace_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`source` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `segment_id`, `contact_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "segment_memberships_source_check" CHECK("segment_memberships"."source" IN ('static', 'dynamic', 'automation'))
);
--> statement-breakpoint
CREATE INDEX `segment_memberships_workspace_contact_idx` ON `segment_memberships` (`workspace_id`,`contact_id`,`segment_id`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`filter_ast` text,
	`member_count` integer DEFAULT 0 NOT NULL,
	`evaluated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "segments_kind_check" CHECK("segments"."kind" IN ('static', 'dynamic'))
);
--> statement-breakpoint
CREATE INDEX `segments_workspace_updated_idx` ON `segments` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `segments_workspace_slug_unique` ON `segments` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `deal_pipelines` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deal_pipelines_workspace_archived_idx` ON `deal_pipelines` (`workspace_id`,`archived_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `deal_pipelines_workspace_name_unique` ON `deal_pipelines` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `deal_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL,
	`position` integer NOT NULL,
	`probability` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pipeline_id`) REFERENCES `deal_pipelines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deal_stages_probability_check" CHECK("deal_stages"."probability" >= 0 AND "deal_stages"."probability" <= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deal_stages_pipeline_position_unique` ON `deal_stages` (`pipeline_id`,`position`);--> statement-breakpoint
CREATE INDEX `deal_stages_workspace_pipeline_idx` ON `deal_stages` (`workspace_id`,`pipeline_id`);--> statement-breakpoint
CREATE TABLE `deal_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`deal_id` text NOT NULL,
	`type` text DEFAULT 'task' NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`due_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_user_id` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deal_tasks_type_check" CHECK("deal_tasks"."type" IN ('task', 'call', 'email', 'meeting')),
	CONSTRAINT "deal_tasks_status_check" CHECK("deal_tasks"."status" IN ('open', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_deal_status_idx` ON `deal_tasks` (`workspace_id`,`deal_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_assignee_idx` ON `deal_tasks` (`workspace_id`,`assigned_user_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_status_completed_idx` ON `deal_tasks` (`workspace_id`,`status`,`completed_at`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`name` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'JPY' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`owner_user_id` text,
	`contact_id` text,
	`company_id` text,
	`expected_close_date` text,
	`description` text DEFAULT '' NOT NULL,
	`won_at` text,
	`lost_at` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pipeline_id`) REFERENCES `deal_pipelines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stage_id`) REFERENCES `deal_stages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deals_value_check" CHECK("deals"."value" >= 0),
	CONSTRAINT "deals_status_check" CHECK("deals"."status" IN ('open', 'won', 'lost')),
	CONSTRAINT "deals_currency_check" CHECK(length("deals"."currency") = 3)
);
--> statement-breakpoint
CREATE INDEX `deals_workspace_pipeline_stage_idx` ON `deals` (`workspace_id`,`pipeline_id`,`stage_id`,`status`);--> statement-breakpoint
CREATE INDEX `deals_workspace_owner_idx` ON `deals` (`workspace_id`,`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `deals_workspace_contact_idx` ON `deals` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `deals_workspace_company_idx` ON `deals` (`workspace_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `deals_workspace_updated_idx` ON `deals` (`workspace_id`,`archived_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `deals_workspace_currency_created_idx` ON `deals` (`workspace_id`,`currency`,`created_at`);--> statement-breakpoint
CREATE INDEX `deals_workspace_currency_won_idx` ON `deals` (`workspace_id`,`currency`,`won_at`);--> statement-breakpoint
CREATE INDEX `deals_workspace_currency_lost_idx` ON `deals` (`workspace_id`,`currency`,`lost_at`);--> statement-breakpoint
CREATE INDEX `deals_workspace_currency_close_idx` ON `deals` (`workspace_id`,`currency`,`status`,`expected_close_date`);--> statement-breakpoint
CREATE TABLE `consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`topic_id` text,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`proof` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `subscription_topics`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "consent_events_action_check" CHECK("consent_events"."action" IN ('granted', 'revoked', 'confirmed', 'unsubscribed'))
);
--> statement-breakpoint
CREATE INDEX `consent_events_workspace_contact_idx` ON `consent_events` (`workspace_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contact_subscriptions` (
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `contact_id`, `topic_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `subscription_topics`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contact_subscriptions_status_check" CHECK("contact_subscriptions"."status" IN ('subscribed', 'unsubscribed', 'pending'))
);
--> statement-breakpoint
CREATE INDEX `contact_subscriptions_workspace_status_idx` ON `contact_subscriptions` (`workspace_id`,`topic_id`,`status`);--> statement-breakpoint
CREATE TABLE `subscription_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_topics_workspace_slug_unique` ON `subscription_topics` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text,
	`email` text,
	`reason` text NOT NULL,
	`provider` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "suppressions_reason_check" CHECK("suppressions"."reason" IN ('global_unsubscribe', 'bounce', 'complaint', 'manual')),
	CONSTRAINT "suppressions_target_check" CHECK("suppressions"."contact_id" IS NOT NULL OR "suppressions"."email" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `suppressions_workspace_contact_idx` ON `suppressions` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `suppressions_workspace_email_unique` ON `suppressions` (`workspace_id`,`email`) WHERE "suppressions"."email" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `automation_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`automation_version_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`source_event_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_node_id` text,
	`entered_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_version_id`) REFERENCES `automation_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_enrollments_status_check" CHECK("automation_enrollments"."status" IN ('active', 'completed', 'cancelled', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `automation_enrollments_workspace_status_idx` ON `automation_enrollments` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `automation_enrollments_workspace_automation_entered_idx` ON `automation_enrollments` (`workspace_id`,`automation_id`,`entered_at`);--> statement-breakpoint
CREATE INDEX `automation_enrollments_workspace_completed_idx` ON `automation_enrollments` (`workspace_id`,`completed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_enrollment_source_unique` ON `automation_enrollments` (`workspace_id`,`automation_id`,`contact_id`,`source_event_id`);--> statement-breakpoint
CREATE TABLE `automation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`automation_version_id` text NOT NULL,
	`node_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_at` text NOT NULL,
	`lease_id` text,
	`lease_until` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enrollment_id`) REFERENCES `automation_enrollments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_version_id`) REFERENCES `automation_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_jobs_status_check" CHECK("automation_jobs"."status" IN ('pending', 'leased', 'queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `automation_jobs_workspace_enrollment_idx` ON `automation_jobs` (`workspace_id`,`enrollment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_jobs_due_claim_idx` ON `automation_jobs` (`status`,`due_at`,`lease_until`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_jobs_workspace_idempotency_unique` ON `automation_jobs` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `automation_triggers` (
	`automation_version_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`source` text NOT NULL,
	`event_type` text,
	`resource_id` text,
	`reentry` text DEFAULT 'once' NOT NULL,
	`inactivity_days` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`automation_version_id`) REFERENCES `automation_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_triggers_source_check" CHECK("automation_triggers"."source" IN ('segment_joined', 'form_submitted', 'contact_created', 'api_event', 'webhook_event', 'contact_inactive')),
	CONSTRAINT "automation_triggers_reentry_check" CHECK("automation_triggers"."reentry" IN ('once', 'every_time'))
);
--> statement-breakpoint
CREATE INDEX `automation_triggers_workspace_event_idx` ON `automation_triggers` (`workspace_id`,`event_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `automation_triggers_source_idx` ON `automation_triggers` (`source`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `automation_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`graph` text NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_versions_status_check" CHECK("automation_versions"."status" IN ('draft', 'published'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_versions_workspace_automation_version_unique` ON `automation_versions` (`workspace_id`,`automation_id`,`version`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_version_id` text,
	`published_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automations_status_check" CHECK("automations"."status" IN ('draft', 'active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `automations_workspace_status_updated_idx` ON `automations` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text,
	`enrollment_id` text,
	`broadcast_id` text,
	`channel` text NOT NULL,
	`purpose` text NOT NULL,
	`provider` text NOT NULL,
	`recipient` text,
	`topic_id` text,
	`template_id` text,
	`idempotency_key` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_message_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`enrollment_id`) REFERENCES `automation_enrollments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topic_id`) REFERENCES `subscription_topics`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`template_id`) REFERENCES `email_templates`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deliveries_channel_check" CHECK("deliveries"."channel" IN ('email', 'webhook')),
	CONSTRAINT "deliveries_purpose_check" CHECK("deliveries"."purpose" IN ('transactional', 'marketing')),
	CONSTRAINT "deliveries_provider_check" CHECK("deliveries"."provider" IN ('resend', 'webhook')),
	CONSTRAINT "deliveries_status_check" CHECK("deliveries"."status" IN ('queued', 'sending', 'accepted', 'delivered', 'failed', 'suppressed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `deliveries_workspace_contact_created_idx` ON `deliveries` (`workspace_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deliveries_workspace_status_next_idx` ON `deliveries` (`workspace_id`,`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `deliveries_workspace_channel_created_idx` ON `deliveries` (`workspace_id`,`channel`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_workspace_idempotency_unique` ON `deliveries` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`provider_message_id` text,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "delivery_events_type_check" CHECK("delivery_events"."type" IN ('accepted', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'replied', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `delivery_events_workspace_delivery_idx` ON `delivery_events` (`workspace_id`,`delivery_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `delivery_events_workspace_occurred_idx` ON `delivery_events` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_events_provider_event_unique` ON `delivery_events` (`workspace_id`,`provider`,`provider_event_id`);--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text NOT NULL,
	`resend_template_id` text NOT NULL,
	`resend_alias` text,
	`subject` text,
	`remote_status` text DEFAULT 'draft' NOT NULL,
	`remote_current_version_id` text NOT NULL,
	`has_unpublished_versions` integer DEFAULT false NOT NULL,
	`variables` text DEFAULT '[]' NOT NULL,
	`published_at` text,
	`last_synced_at` text NOT NULL,
	`sync_error` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_templates_purpose_check" CHECK("email_templates"."purpose" IN ('transactional', 'marketing')),
	CONSTRAINT "email_templates_remote_status_check" CHECK("email_templates"."remote_status" IN ('draft', 'published'))
);
--> statement-breakpoint
CREATE INDEX `email_templates_workspace_archived_updated_idx` ON `email_templates` (`workspace_id`,`archived_at`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_resend_template_unique` ON `email_templates` (`resend_template_id`);--> statement-breakpoint
CREATE TABLE `inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text,
	`delivery_id` text,
	`message_id` text,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text,
	`text_body` text,
	`html_body` text,
	`attachment_manifest` text DEFAULT '[]' NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inbound_emails_workspace_contact_idx` ON `inbound_emails` (`workspace_id`,`contact_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `message_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_variables_workspace_archived_updated_idx` ON `message_variables` (`workspace_id`,`archived_at`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_variables_workspace_key_unique` ON `message_variables` (`workspace_id`,`key`);--> statement-breakpoint
CREATE TABLE `broadcast_recipients` (
	`workspace_id` text NOT NULL,
	`broadcast_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`snapshot_at` text NOT NULL,
	`processed_at` text,
	PRIMARY KEY(`workspace_id`, `broadcast_id`, `contact_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `broadcast_recipients_pending_idx` ON `broadcast_recipients` (`workspace_id`,`broadcast_id`,`processed_at`);--> statement-breakpoint
CREATE TABLE `broadcasts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`segment_id` text NOT NULL,
	`template_id` text NOT NULL,
	`topic_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`scheduled_at` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_id`) REFERENCES `email_templates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`topic_id`) REFERENCES `subscription_topics`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "broadcasts_status_check" CHECK("broadcasts"."status" IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `broadcasts_workspace_archived_updated_idx` ON `broadcasts` (`workspace_id`,`archived_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `broadcasts_workspace_status_idx` ON `broadcasts` (`workspace_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`original_filename` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`checksum` text NOT NULL,
	`checksum_algorithm` text DEFAULT 'sha256' NOT NULL,
	`width` integer,
	`height` integer,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_by_user_id` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assets_kind_check" CHECK("assets"."kind" IN ('image', 'document', 'video', 'audio', 'other')),
	CONSTRAINT "assets_visibility_check" CHECK("assets"."visibility" IN ('public', 'private')),
	CONSTRAINT "assets_checksum_algorithm_check" CHECK("assets"."checksum_algorithm" IN ('sha256', 'md5'))
);
--> statement-breakpoint
CREATE INDEX `assets_workspace_archived_created_idx` ON `assets` (`workspace_id`,`archived_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_workspace_key_unique` ON `assets` (`workspace_id`,`r2_key`);--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`form_id` text NOT NULL,
	`contact_id` text,
	`idempotency_key` text NOT NULL,
	`payload` text NOT NULL,
	`ip_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `form_submissions_workspace_form_created_idx` ON `form_submissions` (`workspace_id`,`form_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `form_submissions_workspace_created_idx` ON `form_submissions` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `form_submissions_workspace_idempotency_unique` ON `form_submissions` (`workspace_id`,`form_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `forms` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`definition` text NOT NULL,
	`allowed_domains` text DEFAULT '[]' NOT NULL,
	`turnstile_enabled` integer DEFAULT true NOT NULL,
	`success_message` text DEFAULT 'ありがとうございます。' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "forms_status_check" CHECK("forms"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forms_workspace_slug_unique` ON `forms` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `landing_page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_document` text NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `landing_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landing_page_versions_workspace_page_version_unique` ON `landing_page_versions` (`workspace_id`,`page_id`,`version`);--> statement-breakpoint
CREATE TABLE `landing_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "landing_pages_status_check" CHECK("landing_pages"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landing_pages_workspace_slug_unique` ON `landing_pages` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `project_items` (
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`, `resource_type`, `resource_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_items_resource_type_check" CHECK("project_items"."resource_type" IN ('automation', 'email', 'form', 'page', 'segment'))
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#7c3aed' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_workspace_updated_idx` ON `projects` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `site_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`headline` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`cta_label` text DEFAULT '' NOT NULL,
	`cta_url` text,
	`page_pattern` text DEFAULT '*' NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`impression_count` integer DEFAULT 0 NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "site_messages_status_check" CHECK("site_messages"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `site_messages_workspace_schedule_idx` ON `site_messages` (`workspace_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `site_messages_workspace_status_updated_idx` ON `site_messages` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `site_tracking_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`allowed_domains` text DEFAULT '[]' NOT NULL,
	`consent_mode` text DEFAULT 'required' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "site_tracking_settings_consent_mode_check" CHECK("site_tracking_settings"."consent_mode" IN ('required'))
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "api_keys_role_check" CHECK("api_keys"."role" IN ('owner', 'admin', 'marketer', 'analyst', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX `api_keys_workspace_idx` ON `api_keys` (`workspace_id`,`revoked_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_prefix_unique` ON `api_keys` (`prefix`);--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_configs_provider_check" CHECK("provider_configs"."provider" IN ('resend', 'webhook'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configs_workspace_provider_name_unique` ON `provider_configs` (`workspace_id`,`provider`,`name`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`event_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`http_status` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_retry_idx` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_event_unique` ON `webhook_deliveries` (`workspace_id`,`endpoint_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`event_types` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_endpoints_workspace_idx` ON `webhook_endpoints` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_user_id` text,
	`api_key_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`ip_address` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_workspace_resource_idx` ON `audit_logs` (`workspace_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_workspace_created_idx` ON `audit_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `dead_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`source_queue` text NOT NULL,
	`message_body` text NOT NULL,
	`error` text NOT NULL,
	`attempts` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`replayed_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dead_letters_status_check" CHECK("dead_letters"."status" IN ('pending', 'replayed', 'discarded'))
);
--> statement-breakpoint
CREATE INDEX `dead_letters_workspace_status_idx` ON `dead_letters` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`workspace_id` text NOT NULL,
	`scope` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`response_status` integer,
	`response_body` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `scope`, `idempotency_key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_expiry_idx` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `daily_metrics` (
	`workspace_id` text NOT NULL,
	`metric_date` text NOT NULL,
	`dimension_type` text NOT NULL,
	`dimension_id` text NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`opened` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL,
	`bounced` integer DEFAULT 0 NOT NULL,
	`complained` integer DEFAULT 0 NOT NULL,
	`unsubscribed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`workspace_id`, `metric_date`, `dimension_type`, `dimension_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_metrics_workspace_date_idx` ON `daily_metrics` (`workspace_id`,`metric_date`);