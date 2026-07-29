-- Keep historical Postmark rows readable while allowing all new marketing
-- deliveries and provider configurations to use Resend.
PRAGMA defer_foreign_keys = on;
PRAGMA legacy_alter_table = on;

ALTER TABLE deliveries RENAME TO deliveries_legacy;

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  enrollment_id TEXT REFERENCES campaign_enrollments(id) ON DELETE SET NULL,
  broadcast_id TEXT REFERENCES broadcasts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  purpose TEXT NOT NULL CHECK (purpose IN ('transactional', 'marketing')),
  provider TEXT NOT NULL
    CHECK (provider IN ('cloudflare', 'postmark', 'resend', 'webhook')),
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

INSERT INTO deliveries (
  id, workspace_id, contact_id, enrollment_id, broadcast_id, channel, purpose,
  provider, recipient, topic_id, template_version_id, idempotency_key, payload,
  status, provider_message_id, attempts, next_attempt_at, last_error, created_at,
  updated_at
)
SELECT
  id, workspace_id, contact_id, enrollment_id, broadcast_id, channel, purpose,
  provider, recipient, topic_id, template_version_id, idempotency_key, payload,
  status, provider_message_id, attempts, next_attempt_at, last_error, created_at,
  updated_at
FROM deliveries_legacy;

DROP TABLE deliveries_legacy;

CREATE UNIQUE INDEX deliveries_workspace_idempotency_unique
  ON deliveries(workspace_id, idempotency_key);
CREATE INDEX deliveries_workspace_status_next_idx
  ON deliveries(workspace_id, status, next_attempt_at);
CREATE INDEX deliveries_workspace_contact_created_idx
  ON deliveries(workspace_id, contact_id, created_at DESC);

ALTER TABLE provider_configs RENAME TO provider_configs_legacy;

CREATE TABLE provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('cloudflare', 'postmark', 'resend', 'webhook')),
  name TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO provider_configs (
  id, workspace_id, provider, name, encrypted_credentials, key_version, settings,
  enabled, created_at, updated_at
)
SELECT
  id, workspace_id, provider, name, encrypted_credentials, key_version, settings,
  enabled, created_at, updated_at
FROM provider_configs_legacy;

DROP TABLE provider_configs_legacy;

CREATE UNIQUE INDEX provider_configs_workspace_provider_name_unique
  ON provider_configs(workspace_id, provider, name);

PRAGMA legacy_alter_table = off;
PRAGMA defer_foreign_keys = off;
