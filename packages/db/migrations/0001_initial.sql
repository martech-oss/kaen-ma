PRAGMA foreign_keys = ON;

-- Better Auth core and Organization plugin
CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  two_factor_enabled INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX user_email_unique ON user(email);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  active_organization_id TEXT
);
CREATE UNIQUE INDEX session_token_unique ON session(token);
CREATE INDEX session_user_idx ON session(user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX account_provider_unique ON account(provider_id, account_id);
CREATE INDEX account_user_idx ON account(user_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE organization (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  logo TEXT,
  created_at INTEGER NOT NULL,
  metadata TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC'
);
CREATE UNIQUE INDEX organization_slug_unique ON organization(slug);

CREATE TABLE member (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'admin', 'marketer', 'analyst', 'viewer')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX member_org_user_unique ON member(organization_id, user_id);
CREATE INDEX member_user_idx ON member(user_id);

CREATE TABLE invitation (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  inviter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX invitation_org_email_idx ON invitation(organization_id, email);
CREATE INDEX invitation_inviter_idx ON invitation(inviter_id);

-- Customer data
CREATE TABLE companies (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX companies_workspace_domain_unique
  ON companies(workspace_id, domain) WHERE domain IS NOT NULL;
CREATE INDEX companies_workspace_name_idx ON companies(workspace_id, name);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  visitor_id TEXT,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  external_id TEXT,
  stage TEXT NOT NULL DEFAULT 'lead',
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'anonymous')),
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX contacts_workspace_email_unique
  ON contacts(workspace_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX contacts_workspace_external_unique
  ON contacts(workspace_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX contacts_workspace_visitor_unique
  ON contacts(workspace_id, visitor_id) WHERE visitor_id IS NOT NULL;
CREATE INDEX contacts_workspace_created_idx ON contacts(workspace_id, created_at DESC, id DESC);
CREATE INDEX contacts_workspace_score_idx ON contacts(workspace_id, score);
CREATE INDEX contacts_workspace_stage_idx ON contacts(workspace_id, stage);

CREATE TABLE company_contacts (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, company_id, contact_id)
);
CREATE INDEX company_contacts_workspace_contact_idx
  ON company_contacts(workspace_id, contact_id);

CREATE TABLE custom_field_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'company')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('text', 'number', 'boolean', 'date', 'select')),
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX custom_fields_workspace_entity_key_unique
  ON custom_field_definitions(workspace_id, entity_type, key);

CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tags_workspace_slug_unique ON tags(workspace_id, slug);

CREATE TABLE contact_tags (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, contact_id, tag_id)
);
CREATE INDEX contact_tags_workspace_tag_idx ON contact_tags(workspace_id, tag_id, contact_id);

CREATE TABLE score_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  total INTEGER NOT NULL,
  reason TEXT NOT NULL,
  campaign_enrollment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX score_events_workspace_contact_idx
  ON score_events(workspace_id, contact_id, created_at DESC);

-- Segments and consent
CREATE TABLE segments (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('static', 'dynamic')),
  filter_ast TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX segments_workspace_slug_unique ON segments(workspace_id, slug);
CREATE INDEX segments_workspace_updated_idx ON segments(workspace_id, updated_at DESC);

CREATE TABLE segment_memberships (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('static', 'dynamic', 'campaign')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, segment_id, contact_id)
);
CREATE INDEX segment_memberships_workspace_contact_idx
  ON segment_memberships(workspace_id, contact_id, segment_id);

CREATE TABLE subscription_topics (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX topics_workspace_slug_unique ON subscription_topics(workspace_id, slug);

CREATE TABLE contact_subscriptions (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES subscription_topics(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('subscribed', 'unsubscribed', 'pending')),
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, contact_id, topic_id)
);
CREATE INDEX contact_subscriptions_workspace_status_idx
  ON contact_subscriptions(workspace_id, topic_id, status);

CREATE TABLE consent_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES subscription_topics(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked', 'confirmed', 'unsubscribed')),
  source TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  proof TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX consent_events_workspace_contact_idx
  ON consent_events(workspace_id, contact_id, created_at DESC);

CREATE TABLE suppressions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  email TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('global_unsubscribe', 'bounce', 'complaint', 'manual')),
  provider TEXT,
  created_at TEXT NOT NULL,
  CHECK (contact_id IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX suppressions_workspace_email_unique
  ON suppressions(workspace_id, email) WHERE email IS NOT NULL;
CREATE INDEX suppressions_workspace_contact_idx ON suppressions(workspace_id, contact_id);

-- Content and acquisition
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#7c3aed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX projects_workspace_updated_idx ON projects(workspace_id, updated_at DESC);

CREATE TABLE project_items (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('campaign', 'email', 'form', 'page', 'segment')),
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, project_id, resource_type, resource_id)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX assets_workspace_key_unique ON assets(workspace_id, r2_key);
CREATE INDEX assets_workspace_created_idx ON assets(workspace_id, created_at DESC);

CREATE TABLE email_templates (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('transactional', 'marketing')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX email_templates_workspace_updated_idx
  ON email_templates(workspace_id, updated_at DESC);

CREATE TABLE email_template_versions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT NOT NULL DEFAULT '',
  content_document TEXT NOT NULL,
  html TEXT,
  text TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX email_versions_workspace_template_version_unique
  ON email_template_versions(workspace_id, template_id, version);

CREATE TABLE forms (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  definition TEXT NOT NULL,
  allowed_domains TEXT NOT NULL DEFAULT '[]',
  turnstile_enabled INTEGER NOT NULL DEFAULT 1,
  success_message TEXT NOT NULL DEFAULT 'ありがとうございます。',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX forms_workspace_slug_unique ON forms(workspace_id, slug);

CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX form_submissions_workspace_idempotency_unique
  ON form_submissions(workspace_id, form_id, idempotency_key);
CREATE INDEX form_submissions_workspace_form_created_idx
  ON form_submissions(workspace_id, form_id, created_at DESC);

CREATE TABLE landing_pages (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX pages_workspace_slug_unique ON landing_pages(workspace_id, slug);

CREATE TABLE landing_page_versions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_document TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX page_versions_workspace_page_version_unique
  ON landing_page_versions(workspace_id, page_id, version);

-- Automation state machine
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  draft_version_id TEXT,
  published_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX campaigns_workspace_status_updated_idx
  ON campaigns(workspace_id, status, updated_at DESC);

CREATE TABLE campaign_versions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  graph TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX campaign_versions_workspace_campaign_version_unique
  ON campaign_versions(workspace_id, campaign_id, version);

CREATE TABLE campaign_enrollments (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_version_id TEXT NOT NULL REFERENCES campaign_versions(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  current_node_id TEXT,
  entered_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX campaign_enrollment_source_unique
  ON campaign_enrollments(workspace_id, campaign_version_id, contact_id, source_event_id);
CREATE INDEX campaign_enrollments_workspace_status_idx
  ON campaign_enrollments(workspace_id, status, updated_at);

CREATE TABLE campaign_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  enrollment_id TEXT NOT NULL REFERENCES campaign_enrollments(id) ON DELETE CASCADE,
  campaign_version_id TEXT NOT NULL REFERENCES campaign_versions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
  due_at TEXT NOT NULL,
  lease_id TEXT,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX campaign_jobs_workspace_idempotency_unique
  ON campaign_jobs(workspace_id, idempotency_key);
CREATE INDEX campaign_jobs_due_claim_idx
  ON campaign_jobs(status, due_at, lease_until);
CREATE INDEX campaign_jobs_workspace_enrollment_idx
  ON campaign_jobs(workspace_id, enrollment_id, created_at);

CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE RESTRICT,
  template_version_id TEXT NOT NULL REFERENCES email_template_versions(id) ON DELETE RESTRICT,
  topic_id TEXT REFERENCES subscription_topics(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX broadcasts_workspace_status_idx ON broadcasts(workspace_id, status, scheduled_at);

CREATE TABLE broadcast_recipients (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  broadcast_id TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  snapshot_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, broadcast_id, contact_id)
);
CREATE INDEX broadcast_recipients_status_idx
  ON broadcast_recipients(workspace_id, broadcast_id, status);

-- Delivery, events, integrations, operations
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  enrollment_id TEXT REFERENCES campaign_enrollments(id) ON DELETE SET NULL,
  broadcast_id TEXT REFERENCES broadcasts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  purpose TEXT NOT NULL CHECK (purpose IN ('transactional', 'marketing')),
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare', 'postmark', 'webhook')),
  recipient TEXT NOT NULL,
  topic_id TEXT REFERENCES subscription_topics(id) ON DELETE SET NULL,
  template_version_id TEXT REFERENCES email_template_versions(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'accepted', 'delivered', 'failed', 'suppressed', 'cancelled')),
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX deliveries_workspace_idempotency_unique
  ON deliveries(workspace_id, idempotency_key);
CREATE INDEX deliveries_workspace_status_next_idx
  ON deliveries(workspace_id, status, next_attempt_at);
CREATE INDEX deliveries_workspace_contact_created_idx
  ON deliveries(workspace_id, contact_id, created_at DESC);

CREATE TABLE delivery_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  provider_message_id TEXT,
  type TEXT NOT NULL CHECK (
    type IN ('accepted', 'delivered', 'opened', 'clicked', 'bounced',
             'complained', 'unsubscribed', 'replied', 'failed')
  ),
  occurred_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX delivery_events_provider_event_unique
  ON delivery_events(workspace_id, provider, provider_event_id);
CREATE INDEX delivery_events_workspace_occurred_idx
  ON delivery_events(workspace_id, occurred_at DESC);
CREATE INDEX delivery_events_workspace_delivery_idx
  ON delivery_events(workspace_id, delivery_id, occurred_at);

CREATE TABLE contact_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  visitor_id TEXT,
  type TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  properties TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX contact_events_workspace_contact_idx
  ON contact_events(workspace_id, contact_id, occurred_at DESC);
CREATE INDEX contact_events_workspace_type_occurred_idx
  ON contact_events(workspace_id, type, occurred_at DESC);
CREATE INDEX contact_events_workspace_visitor_idx
  ON contact_events(workspace_id, visitor_id, occurred_at DESC);

CREATE TABLE provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare', 'postmark', 'webhook')),
  name TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX provider_configs_workspace_provider_name_unique
  ON provider_configs(workspace_id, provider, name);

CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  event_types TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX webhook_endpoints_workspace_idx ON webhook_endpoints(workspace_id, enabled);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX webhook_delivery_event_unique
  ON webhook_deliveries(workspace_id, endpoint_id, event_id);
CREATE INDEX webhook_deliveries_retry_idx
  ON webhook_deliveries(status, next_attempt_at);

CREATE TABLE inbound_emails (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  delivery_id TEXT REFERENCES deliveries(id) ON DELETE SET NULL,
  message_id TEXT,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  attachment_manifest TEXT NOT NULL DEFAULT '[]',
  received_at TEXT NOT NULL
);
CREATE INDEX inbound_emails_workspace_contact_idx
  ON inbound_emails(workspace_id, contact_id, received_at DESC);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'marketer', 'analyst', 'viewer')),
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX api_keys_prefix_unique ON api_keys(prefix);
CREATE INDEX api_keys_workspace_idx ON api_keys(workspace_id, revoked_at);

CREATE TABLE idempotency_keys (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, scope, idempotency_key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys(expires_at);

CREATE TABLE dead_letters (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
  source_queue TEXT NOT NULL,
  message_body TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replayed', 'discarded')),
  created_at TEXT NOT NULL,
  replayed_at TEXT
);
CREATE INDEX dead_letters_workspace_status_idx
  ON dead_letters(workspace_id, status, created_at DESC);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_logs_workspace_created_idx
  ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX audit_logs_workspace_resource_idx
  ON audit_logs(workspace_id, resource_type, resource_id);

CREATE TABLE daily_metrics (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  metric_date TEXT NOT NULL,
  dimension_type TEXT NOT NULL,
  dimension_id TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  clicked INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  complained INTEGER NOT NULL DEFAULT 0,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, metric_date, dimension_type, dimension_id)
);
CREATE INDEX daily_metrics_workspace_date_idx
  ON daily_metrics(workspace_id, metric_date DESC);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('contact_import', 'contact_export', 'event_archive')),
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cursor TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error_manifest_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX import_jobs_workspace_status_idx
  ON import_jobs(workspace_id, status, created_at DESC);
