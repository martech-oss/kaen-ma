CREATE TABLE campaign_triggers (
  campaign_version_id TEXT PRIMARY KEY NOT NULL
    REFERENCES campaign_versions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (
    source IN (
      'segment_joined',
      'form_submitted',
      'contact_created',
      'api_event',
      'webhook_event',
      'contact_inactive'
    )
  ),
  event_type TEXT,
  resource_id TEXT,
  reentry TEXT NOT NULL DEFAULT 'once' CHECK (reentry IN ('once', 'every_time')),
  inactivity_days INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX campaign_triggers_workspace_event_idx
  ON campaign_triggers(workspace_id, event_type, resource_id);
CREATE INDEX campaign_triggers_source_idx
  ON campaign_triggers(source, workspace_id);

DROP INDEX campaign_enrollment_source_unique;
CREATE UNIQUE INDEX campaign_enrollment_source_unique
  ON campaign_enrollments(workspace_id, campaign_id, contact_id, source_event_id);
