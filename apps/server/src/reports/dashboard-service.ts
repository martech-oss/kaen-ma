import type { KaenmaDatabase } from "@kaenma/database";
import type { Dashboard } from "@kaenma/orpc";

import { numericValue, parseJsonRecord, primitiveString } from "../platform/values";

export async function getDashboard(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<Dashboard> {
  const batch = await database.batch([
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND status = 'active'",
      )
      .bind(workspaceId),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM campaigns WHERE workspace_id = ? AND status = 'active'",
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT COUNT(*) AS sent,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM deliveries WHERE workspace_id = ? AND created_at >= datetime('now', '-30 day')`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT type, occurred_at, contact_id, properties FROM contact_events
         WHERE workspace_id = ? ORDER BY occurred_at DESC LIMIT 20`,
      )
      .bind(workspaceId),
  ]);
  const first = (index: number): Record<string, unknown> =>
    (batch[index]?.results[0] ?? {}) as Record<string, unknown>;
  const events = (batch[3]?.results ?? []) as Array<Record<string, unknown>>;
  return {
    contacts: { count: numericValue(first(0)["count"]) },
    campaigns: { count: numericValue(first(1)["count"]) },
    deliveries: {
      sent: numericValue(first(2)["sent"]),
      delivered: numericValue(first(2)["delivered"]),
      failed: numericValue(first(2)["failed"]),
    },
    recentEvents: events.map((row) => ({
      type: primitiveString(row["type"]),
      occurredAt: primitiveString(row["occurred_at"]),
      contactId: row["contact_id"] === null ? null : primitiveString(row["contact_id"]),
      properties: parseJsonRecord(row["properties"]),
    })),
  };
}
