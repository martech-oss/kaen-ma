import { createDatabase, type DatabaseSource } from "../client";
import { uuidv7 } from "../shared/uuid";

export async function claimDueJobs(
  database: DatabaseSource,
  now: string,
  leaseUntil: string,
  limit = 100,
  workspaceId?: string,
): Promise<Array<{ id: string; leaseId: string }>> {
  const drizzle = createDatabase(database);
  const candidates = await drizzle
    .prepare(
      `SELECT id FROM campaign_jobs
       WHERE status = 'pending' AND due_at <= ? AND (lease_until IS NULL OR lease_until < ?)
         ${workspaceId ? "AND workspace_id = ?" : ""}
       ORDER BY due_at ASC LIMIT ?`,
    )
    .bind(...(workspaceId ? [now, now, workspaceId, limit] : [now, now, limit]))
    .all<{ id: string }>();
  const claimed: Array<{ id: string; leaseId: string }> = [];
  for (const candidate of candidates.results) {
    const leaseId = uuidv7();
    const result = await drizzle
      .prepare(
        `UPDATE campaign_jobs SET status = 'leased', lease_id = ?, lease_until = ?, updated_at = ?
         WHERE id = ? AND status = 'pending' AND (lease_until IS NULL OR lease_until < ?)`,
      )
      .bind(leaseId, leaseUntil, now, candidate.id, now)
      .run();
    if (result.meta.changes === 1) claimed.push({ id: candidate.id, leaseId });
  }
  return claimed;
}
