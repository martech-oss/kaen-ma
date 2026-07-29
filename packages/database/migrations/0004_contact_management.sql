ALTER TABLE contacts ADD COLUMN archived_at TEXT;

CREATE INDEX contacts_workspace_status_updated_idx
  ON contacts(workspace_id, status, updated_at DESC);

CREATE TABLE contact_lists (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX contact_lists_workspace_slug_unique
  ON contact_lists(workspace_id, slug);
CREATE INDEX contact_lists_workspace_updated_idx
  ON contact_lists(workspace_id, updated_at DESC);

CREATE TABLE contact_list_memberships (
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'unsubscribed')),
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, list_id, contact_id)
);
CREATE INDEX contact_list_memberships_workspace_contact_idx
  ON contact_list_memberships(workspace_id, contact_id, list_id);
CREATE INDEX contact_list_memberships_workspace_list_status_idx
  ON contact_list_memberships(workspace_id, list_id, status, contact_id);
