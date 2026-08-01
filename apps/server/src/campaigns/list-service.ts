import type { KaenmaDatabase } from "@kaenma/database";
import type { CampaignRow } from "@kaenma/orpc";

import { numericValue, primitiveString } from "../values";

export async function listCampaigns(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<CampaignRow[]> {
  const result = await database
    .prepare(
      `SELECT id, name, description, status, draft_version_id, published_version_id,
              created_at, updated_at,
              (SELECT COUNT(*) FROM campaign_enrollments ce
               WHERE ce.workspace_id = campaigns.workspace_id
                 AND ce.campaign_id = campaigns.id) AS enrollment_count,
              (SELECT COUNT(*) FROM campaign_enrollments ce
               WHERE ce.workspace_id = campaigns.workspace_id
                 AND ce.campaign_id = campaigns.id
                 AND ce.status = 'active') AS active_count,
              (SELECT COUNT(*) FROM campaign_enrollments ce
               WHERE ce.workspace_id = campaigns.workspace_id
                 AND ce.campaign_id = campaigns.id
                 AND ce.status = 'completed') AS completed_count,
              (SELECT ct.source FROM campaign_triggers ct
               WHERE ct.workspace_id = campaigns.workspace_id
                 AND ct.campaign_version_id = campaigns.published_version_id) AS trigger_source
       FROM campaigns WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`,
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    description: primitiveString(row["description"]),
    status: normalizeCampaignStatus(row["status"]),
    triggerSource: row["trigger_source"] === null ? null : primitiveString(row["trigger_source"]),
    enrollmentCount: numericValue(row["enrollment_count"]),
    activeCount: numericValue(row["active_count"]),
    completedCount: numericValue(row["completed_count"]),
    updatedAt: primitiveString(row["updated_at"]),
  }));
}

export function normalizeCampaignStatus(value: unknown): CampaignRow["status"] {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft";
}
