import { uuidv7 } from "@kaenma/database";

import { hasWorkspaceRole } from "../auth/authorization";
import { sha256Hex } from "../crypto";
import { randomString } from "../http/helpers";
import { authed } from "../orpc/base";
import { isRecord, primitiveString } from "../values";

function num(value: unknown): number {
  return Number(value ?? 0);
}

export const dashboardProcedure = authed.operations.dashboard.handler(async ({ context }) => {
  const database = context.database;
  const workspaceId = context.workspace.workspaceId;
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
    contacts: { count: num(first(0)["count"]) },
    campaigns: { count: num(first(1)["count"]) },
    deliveries: {
      sent: num(first(2)["sent"]),
      delivered: num(first(2)["delivered"]),
      failed: num(first(2)["failed"]),
    },
    recentEvents: events.map((row) => {
      let properties: unknown = {};
      if (typeof row["properties"] === "string") {
        try {
          properties = JSON.parse(row["properties"]) as unknown;
        } catch {
          properties = {};
        }
      }
      return {
        type: primitiveString(row["type"]),
        occurredAt: primitiveString(row["occurred_at"]),
        contactId: row["contact_id"] === null ? null : primitiveString(row["contact_id"]),
        properties: isRecord(properties) ? properties : {},
      };
    }),
  };
});

export const createApiKeyProcedure = authed.operations.createApiKey.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "admin")) throw errors.FORBIDDEN();
    const prefix = randomString(12);
    const token = `kaenma_${prefix}_${randomString(40)}`;
    const id = uuidv7();
    await context.database
      .prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.workspace.workspaceId,
        context.workspace.userId,
        input.name,
        prefix,
        await sha256Hex(token),
        input.role,
        input.expiresAt ?? null,
        new Date().toISOString(),
      )
      .run();
    return { id, token };
  },
);
