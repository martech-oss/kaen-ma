CREATE TABLE deal_pipelines (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX deal_pipelines_workspace_archived_idx
  ON deal_pipelines(workspace_id, archived_at);
CREATE UNIQUE INDEX deal_pipelines_workspace_name_unique
  ON deal_pipelines(workspace_id, name);

CREATE TABLE deal_stages (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  pipeline_id TEXT NOT NULL REFERENCES deal_pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  position INTEGER NOT NULL,
  probability INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT deal_stages_probability_check
    CHECK (probability >= 0 AND probability <= 100)
);

CREATE UNIQUE INDEX deal_stages_pipeline_position_unique
  ON deal_stages(pipeline_id, position);
CREATE INDEX deal_stages_workspace_pipeline_idx
  ON deal_stages(workspace_id, pipeline_id);

CREATE TABLE deals (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  pipeline_id TEXT NOT NULL REFERENCES deal_pipelines(id) ON DELETE RESTRICT,
  stage_id TEXT NOT NULL REFERENCES deal_stages(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'JPY',
  status TEXT NOT NULL DEFAULT 'open',
  owner_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  account_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  expected_close_date TEXT,
  description TEXT NOT NULL DEFAULT '',
  won_at TEXT,
  lost_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT deals_value_check CHECK (value >= 0),
  CONSTRAINT deals_status_check CHECK (status IN ('open', 'won', 'lost')),
  CONSTRAINT deals_currency_check CHECK (length(currency) = 3)
);

CREATE INDEX deals_workspace_pipeline_stage_idx
  ON deals(workspace_id, pipeline_id, stage_id, status);
CREATE INDEX deals_workspace_owner_idx
  ON deals(workspace_id, owner_user_id, status);
CREATE INDEX deals_workspace_contact_idx
  ON deals(workspace_id, contact_id);
CREATE INDEX deals_workspace_account_idx
  ON deals(workspace_id, account_id);
CREATE INDEX deals_workspace_updated_idx
  ON deals(workspace_id, archived_at, updated_at);

CREATE TABLE deal_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'task',
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT deal_tasks_type_check
    CHECK (type IN ('task', 'call', 'email', 'meeting')),
  CONSTRAINT deal_tasks_status_check
    CHECK (status IN ('open', 'completed'))
);

CREATE INDEX deal_tasks_workspace_deal_status_idx
  ON deal_tasks(workspace_id, deal_id, status, due_at);
CREATE INDEX deal_tasks_workspace_assignee_idx
  ON deal_tasks(workspace_id, assigned_user_id, status, due_at);
