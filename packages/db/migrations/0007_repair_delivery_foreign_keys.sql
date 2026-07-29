-- 0003 renamed deliveries while SQLite was preserving legacy foreign-key names.
-- Rebuild the two referencing tables so new events and inbound replies point to
-- the current deliveries table.
PRAGMA defer_foreign_keys = on;
PRAGMA legacy_alter_table = on;

ALTER TABLE delivery_events RENAME TO delivery_events_legacy;

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
  id, workspace_id, delivery_id, provider, provider_event_id,
  provider_message_id, type, occurred_at, metadata, archived_at, created_at
FROM delivery_events_legacy;

DROP TABLE delivery_events_legacy;

CREATE UNIQUE INDEX delivery_events_provider_event_unique
  ON delivery_events(workspace_id, provider, provider_event_id);
CREATE INDEX delivery_events_workspace_occurred_idx
  ON delivery_events(workspace_id, occurred_at DESC);
CREATE INDEX delivery_events_workspace_delivery_idx
  ON delivery_events(workspace_id, delivery_id, occurred_at);

ALTER TABLE inbound_emails RENAME TO inbound_emails_legacy;

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
  id, workspace_id, contact_id, delivery_id, message_id, sender, recipient,
  subject, text_body, html_body, attachment_manifest, received_at
FROM inbound_emails_legacy;

DROP TABLE inbound_emails_legacy;

CREATE INDEX inbound_emails_workspace_contact_idx
  ON inbound_emails(workspace_id, contact_id, received_at DESC);

PRAGMA legacy_alter_table = off;
PRAGMA defer_foreign_keys = off;
