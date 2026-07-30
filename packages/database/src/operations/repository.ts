import { createDatabase, type DatabaseSource } from "../client";

export async function reserveIdempotencyKey(
  database: DatabaseSource,
  workspaceId: string,
  scope: string,
  key: string,
  expiresAt: string,
): Promise<boolean> {
  const result = await createDatabase(database)
    .prepare(
      `INSERT OR IGNORE INTO idempotency_keys
       (workspace_id, scope, idempotency_key, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(workspaceId, scope, key, new Date().toISOString(), expiresAt)
    .run();
  return result.meta.changes === 1;
}
