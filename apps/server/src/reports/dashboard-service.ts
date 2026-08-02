import { ReportsRepository, type KaenmaDatabase } from "@kaenma/database";
import type { Dashboard } from "@kaenma/orpc";

import { numericValue, parseJsonRecord, primitiveString } from "../platform/values";

export async function getDashboard(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<Dashboard> {
  const data = await new ReportsRepository(database).dashboardSummary(workspaceId);
  return {
    contacts: { count: numericValue(data.contacts["count"]) },
    campaigns: { count: numericValue(data.campaigns["count"]) },
    deliveries: {
      sent: numericValue(data.deliveries["sent"]),
      delivered: numericValue(data.deliveries["delivered"]),
      failed: numericValue(data.deliveries["failed"]),
    },
    recentEvents: data.events.map((row) => ({
      type: primitiveString(row["type"]),
      occurredAt: primitiveString(row["occurred_at"]),
      contactId: row["contact_id"] === null ? null : primitiveString(row["contact_id"]),
      properties: parseJsonRecord(row["properties"]),
    })),
  };
}
