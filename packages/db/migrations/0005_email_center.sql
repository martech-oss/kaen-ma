ALTER TABLE broadcasts ADD COLUMN archived_at TEXT;

CREATE INDEX broadcasts_workspace_archived_updated_idx
  ON broadcasts(workspace_id, archived_at, updated_at DESC);

CREATE TABLE message_variables (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX message_variables_workspace_key_unique
  ON message_variables(workspace_id, key);
CREATE INDEX message_variables_workspace_archived_updated_idx
  ON message_variables(workspace_id, archived_at, updated_at DESC);
