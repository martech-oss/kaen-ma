-- Replace locally-rendered email versions with workspace-scoped registrations
-- of Resend hosted templates. Existing local templates are retained as archived
-- legacy rows because they cannot be converted into Resend resources offline.
PRAGMA defer_foreign_keys = on;
PRAGMA legacy_alter_table = on;

ALTER TABLE delivery_events RENAME TO delivery_events_legacy;
ALTER TABLE inbound_emails RENAME TO inbound_emails_legacy;
ALTER TABLE deliveries RENAME TO deliveries_legacy;
ALTER TABLE broadcast_recipients RENAME TO broadcast_recipients_legacy;
ALTER TABLE broadcasts RENAME TO broadcasts_legacy;
ALTER TABLE email_template_versions RENAME TO email_template_versions_legacy;
ALTER TABLE email_templates RENAME TO email_templates_legacy;

DROP INDEX IF EXISTS broadcasts_workspace_status_idx;
DROP INDEX IF EXISTS broadcasts_workspace_archived_updated_idx;
DROP INDEX IF EXISTS broadcast_recipients_status_idx;
DROP INDEX IF EXISTS deliveries_workspace_idempotency_unique;
DROP INDEX IF EXISTS deliveries_workspace_status_next_idx;
DROP INDEX IF EXISTS deliveries_workspace_contact_created_idx;
DROP INDEX IF EXISTS delivery_events_provider_event_unique;
DROP INDEX IF EXISTS delivery_events_workspace_occurred_idx;
DROP INDEX IF EXISTS delivery_events_workspace_delivery_idx;
DROP INDEX IF EXISTS inbound_emails_workspace_contact_idx;

CREATE TABLE email_templates (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('transactional', 'marketing')),
  resend_template_id TEXT NOT NULL,
  resend_alias TEXT,
  subject TEXT,
  remote_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (remote_status IN ('draft', 'published')),
  remote_current_version_id TEXT NOT NULL,
  has_unpublished_versions INTEGER NOT NULL DEFAULT 0,
  variables TEXT NOT NULL DEFAULT '[]',
  published_at TEXT,
  last_synced_at TEXT NOT NULL,
  sync_error TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO email_templates (
  id, workspace_id, name, purpose, resend_template_id, remote_status,
  remote_current_version_id, variables, last_synced_at, sync_error, archived_at,
  created_at, updated_at
)
SELECT
  id, workspace_id, name, purpose, 'legacy-' || id, 'draft', 'legacy', '[]',
  updated_at, 'Resend Templateとして再登録してください', updated_at,
  created_at, updated_at
FROM email_templates_legacy;

-- Campaign graphs stored the old immutable version ID. Convert it to the
-- owning local template ID so drafts remain editable after the schema change.
UPDATE campaign_versions AS cv
SET graph = json_set(
  cv.graph,
  '$.nodes',
  (
    SELECT json_group_array(
      json(
        CASE
          WHEN json_extract(node.value, '$.type') = 'action'
           AND json_extract(node.value, '$.config.action') = 'send_email'
          THEN json_remove(
            json_set(
              node.value,
              '$.config.templateId',
              COALESCE(
                (
                  SELECT ev.template_id
                  FROM email_template_versions_legacy ev
                  WHERE ev.workspace_id = cv.workspace_id
                    AND ev.id = json_extract(node.value, '$.config.templateVersionId')
                ),
                json_extract(node.value, '$.config.templateVersionId')
              )
            ),
            '$.config.templateVersionId',
            '$.config.purpose',
            '$.config.provider'
          )
          ELSE node.value
        END
      )
    )
    FROM json_each(cv.graph, '$.nodes') node
  )
)
WHERE EXISTS (
  SELECT 1
  FROM json_each(cv.graph, '$.nodes') node
  WHERE json_extract(node.value, '$.type') = 'action'
    AND json_extract(node.value, '$.config.action') = 'send_email'
);

-- Legacy local templates cannot be sent through Resend. Stop affected
-- automations and in-flight work until a published Resend Template is selected.
UPDATE campaign_jobs
SET status = 'cancelled',
    lease_id = NULL,
    lease_until = NULL,
    last_error = 'Resend Templateを再登録してフローを再公開してください'
WHERE status IN ('pending', 'leased', 'queued', 'running', 'failed')
  AND campaign_version_id IN (
    SELECT cv.id
    FROM campaign_versions cv, json_each(cv.graph, '$.nodes') node
    WHERE json_extract(node.value, '$.type') = 'action'
      AND json_extract(node.value, '$.config.action') = 'send_email'
  );

UPDATE campaign_enrollments
SET status = 'cancelled',
    completed_at = COALESCE(completed_at, updated_at)
WHERE status = 'active'
  AND campaign_version_id IN (
    SELECT cv.id
    FROM campaign_versions cv, json_each(cv.graph, '$.nodes') node
    WHERE json_extract(node.value, '$.type') = 'action'
      AND json_extract(node.value, '$.config.action') = 'send_email'
  );

UPDATE campaigns
SET status = 'paused'
WHERE status = 'active'
  AND id IN (
    SELECT cv.campaign_id
    FROM campaign_versions cv, json_each(cv.graph, '$.nodes') node
    WHERE json_extract(node.value, '$.type') = 'action'
      AND json_extract(node.value, '$.config.action') = 'send_email'
  );

CREATE UNIQUE INDEX email_templates_resend_template_unique
  ON email_templates(resend_template_id);
CREATE INDEX email_templates_workspace_archived_updated_idx
  ON email_templates(workspace_id, archived_at, updated_at DESC);

CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE RESTRICT,
  template_id TEXT NOT NULL REFERENCES email_templates(id) ON DELETE RESTRICT,
  topic_id TEXT REFERENCES subscription_topics(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

INSERT INTO broadcasts (
  id, workspace_id, name, segment_id, template_id, topic_id, status,
  scheduled_at, started_at, completed_at, created_at, updated_at, archived_at
)
SELECT
  b.id, b.workspace_id, b.name, b.segment_id, ev.template_id, b.topic_id,
  CASE WHEN b.status IN ('sending', 'scheduled') THEN 'cancelled' ELSE b.status END,
  NULL, b.started_at, b.completed_at, b.created_at, b.updated_at,
  COALESCE(b.archived_at, b.updated_at)
FROM broadcasts_legacy b
JOIN email_template_versions_legacy ev
  ON ev.id = b.template_version_id AND ev.workspace_id = b.workspace_id;

CREATE INDEX broadcasts_workspace_status_idx
  ON broadcasts(workspace_id, status, scheduled_at);
CREATE INDEX broadcasts_workspace_archived_updated_idx
  ON broadcasts(workspace_id, archived_at, updated_at DESC);

CREATE TABLE broadcast_recipients (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  broadcast_id TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  snapshot_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, broadcast_id, contact_id)
);

INSERT INTO broadcast_recipients (
  workspace_id, broadcast_id, contact_id, status, snapshot_at
)
SELECT workspace_id, broadcast_id, contact_id, status, snapshot_at
FROM broadcast_recipients_legacy
WHERE broadcast_id IN (SELECT id FROM broadcasts);

CREATE INDEX broadcast_recipients_status_idx
  ON broadcast_recipients(workspace_id, broadcast_id, status);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  enrollment_id TEXT REFERENCES campaign_enrollments(id) ON DELETE SET NULL,
  broadcast_id TEXT REFERENCES broadcasts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  purpose TEXT NOT NULL CHECK (purpose IN ('transactional', 'marketing')),
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'webhook')),
  recipient TEXT NOT NULL,
  topic_id TEXT REFERENCES subscription_topics(id) ON DELETE SET NULL,
  template_id TEXT REFERENCES email_templates(id) ON DELETE SET NULL,
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
  provider, recipient, topic_id, template_id, idempotency_key, payload, status,
  provider_message_id, attempts, next_attempt_at, last_error, created_at, updated_at
)
SELECT
  d.id, d.workspace_id, d.contact_id, d.enrollment_id,
  CASE WHEN b.id IS NULL THEN NULL ELSE d.broadcast_id END,
  d.channel, d.purpose,
  CASE WHEN d.channel = 'webhook' THEN 'webhook' ELSE 'resend' END,
  d.recipient, d.topic_id, ev.template_id, d.idempotency_key, d.payload,
  CASE
    WHEN d.channel = 'email' AND d.status IN ('queued', 'sending') THEN 'failed'
    ELSE d.status
  END,
  d.provider_message_id, d.attempts, NULL,
  CASE
    WHEN d.channel = 'email' AND d.status IN ('queued', 'sending')
      THEN 'Legacy local email template cannot be delivered'
    ELSE d.last_error
  END,
  d.created_at, d.updated_at
FROM deliveries_legacy d
LEFT JOIN email_template_versions_legacy ev
  ON ev.id = d.template_version_id AND ev.workspace_id = d.workspace_id
LEFT JOIN broadcasts b ON b.id = d.broadcast_id;

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

INSERT INTO delivery_events (
  id, workspace_id, delivery_id, provider, provider_event_id,
  provider_message_id, type, occurred_at, metadata, archived_at, created_at
)
SELECT
  e.id, e.workspace_id, e.delivery_id, e.provider, e.provider_event_id,
  e.provider_message_id, e.type, e.occurred_at, e.metadata, e.archived_at,
  e.created_at
FROM delivery_events_legacy e
WHERE e.delivery_id IN (SELECT id FROM deliveries);

CREATE UNIQUE INDEX delivery_events_provider_event_unique
  ON delivery_events(workspace_id, provider, provider_event_id);
CREATE INDEX delivery_events_workspace_occurred_idx
  ON delivery_events(workspace_id, occurred_at DESC);
CREATE INDEX delivery_events_workspace_delivery_idx
  ON delivery_events(workspace_id, delivery_id, occurred_at);

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

INSERT INTO inbound_emails (
  id, workspace_id, contact_id, delivery_id, message_id, sender, recipient,
  subject, text_body, html_body, attachment_manifest, received_at
)
SELECT
  i.id, i.workspace_id, i.contact_id, d.id, i.message_id, i.sender, i.recipient,
  i.subject, i.text_body, i.html_body, i.attachment_manifest, i.received_at
FROM inbound_emails_legacy i
LEFT JOIN deliveries d ON d.id = i.delivery_id;

CREATE INDEX inbound_emails_workspace_contact_idx
  ON inbound_emails(workspace_id, contact_id, received_at DESC);

ALTER TABLE provider_configs RENAME TO provider_configs_legacy;
DROP INDEX IF EXISTS provider_configs_workspace_provider_name_unique;

CREATE TABLE provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'webhook')),
  name TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO provider_configs (
  id, workspace_id, provider, name, encrypted_credentials, key_version,
  settings, enabled, created_at, updated_at
)
SELECT
  id, workspace_id, provider, name, encrypted_credentials, key_version,
  settings, enabled, created_at, updated_at
FROM provider_configs_legacy
WHERE provider IN ('resend', 'webhook');

CREATE UNIQUE INDEX provider_configs_workspace_provider_name_unique
  ON provider_configs(workspace_id, provider, name);

DROP TABLE delivery_events_legacy;
DROP TABLE inbound_emails_legacy;
DROP TABLE deliveries_legacy;
DROP TABLE broadcast_recipients_legacy;
DROP TABLE broadcasts_legacy;
DROP TABLE email_template_versions_legacy;
DROP TABLE email_templates_legacy;
DROP TABLE provider_configs_legacy;

PRAGMA legacy_alter_table = off;
PRAGMA defer_foreign_keys = off;
