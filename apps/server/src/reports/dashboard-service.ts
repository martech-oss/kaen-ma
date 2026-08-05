import type { Dashboard } from "@openengage/core/reports";
import { ReportsRepository, type OpenEngageDatabase } from "@openengage/database";

import { numericValue, parseJsonRecord, primitiveString } from "../platform/values";

export async function getDashboard(
  database: OpenEngageDatabase,
  workspaceId: string,
): Promise<Dashboard> {
  const data = await new ReportsRepository(database).dashboardSummary(workspaceId);
  return {
    contacts: { count: numericValue(data.contacts["count"]) },
    automations: { count: numericValue(data.automations["count"]) },
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
