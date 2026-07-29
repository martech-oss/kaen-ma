CREATE TABLE site_tracking_settings (
  workspace_id TEXT PRIMARY KEY NOT NULL
    REFERENCES organization(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  allowed_domains TEXT NOT NULL DEFAULT '[]',
  consent_mode TEXT NOT NULL DEFAULT 'required'
    CHECK (consent_mode IN ('required')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE site_messages (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  headline TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  cta_label TEXT NOT NULL DEFAULT '',
  cta_url TEXT,
  page_pattern TEXT NOT NULL DEFAULT '*',
  starts_at TEXT,
  ends_at TEXT,
  impression_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX site_messages_workspace_status_updated_idx
  ON site_messages(workspace_id, status, updated_at DESC);
CREATE INDEX site_messages_workspace_schedule_idx
  ON site_messages(workspace_id, starts_at, ends_at);
