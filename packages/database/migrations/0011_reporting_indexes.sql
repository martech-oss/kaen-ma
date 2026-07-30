CREATE INDEX campaign_enrollments_workspace_campaign_entered_idx
  ON campaign_enrollments(workspace_id, campaign_id, entered_at);
CREATE INDEX campaign_enrollments_workspace_completed_idx
  ON campaign_enrollments(workspace_id, completed_at);

CREATE INDEX deliveries_workspace_channel_created_idx
  ON deliveries(workspace_id, channel, created_at);

CREATE INDEX form_submissions_workspace_created_idx
  ON form_submissions(workspace_id, created_at);

CREATE INDEX deals_workspace_currency_created_idx
  ON deals(workspace_id, currency, created_at);
CREATE INDEX deals_workspace_currency_won_idx
  ON deals(workspace_id, currency, won_at);
CREATE INDEX deals_workspace_currency_lost_idx
  ON deals(workspace_id, currency, lost_at);
CREATE INDEX deals_workspace_currency_close_idx
  ON deals(workspace_id, currency, status, expected_close_date);

CREATE INDEX deal_tasks_workspace_status_completed_idx
  ON deal_tasks(workspace_id, status, completed_at);
