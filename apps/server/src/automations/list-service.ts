import { CampaignRepository, type KaenmaDatabase } from "@kaenma/database";
import type { CampaignRow } from "@kaenma/orpc";

export async function listCampaigns(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<CampaignRow[]> {
  const repository = new CampaignRepository(database, { workspaceId });
  const rows = await repository.listCampaignsWithCounts();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: normalizeCampaignStatus(row.status),
    triggerSource: row.triggerSource,
    enrollmentCount: row.enrollmentCount,
    activeCount: row.activeCount,
    completedCount: row.completedCount,
    updatedAt: row.updatedAt,
  }));
}

export function normalizeCampaignStatus(value: unknown): CampaignRow["status"] {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft";
}
