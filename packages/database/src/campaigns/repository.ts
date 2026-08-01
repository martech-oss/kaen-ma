import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";

import { createDatabase, type DatabaseSource } from "../client";
import { uuidv7 } from "../shared/uuid";
import { campaignJobs } from "./schema";

export async function claimDueJobs(
  database: DatabaseSource,
  now: string,
  leaseUntil: string,
  limit = 100,
  workspaceId?: string,
): Promise<Array<{ id: string; leaseId: string }>> {
  const kaenmaDatabase = createDatabase(database);
  const drizzle = kaenmaDatabase.orm;
  const conditions = [
    eq(campaignJobs.status, "pending"),
    lte(campaignJobs.dueAt, now),
    or(isNull(campaignJobs.leaseUntil), lt(campaignJobs.leaseUntil, now))!,
  ];
  if (workspaceId) conditions.push(eq(campaignJobs.workspaceId, workspaceId));
  const candidates = await drizzle
    .select({ id: campaignJobs.id })
    .from(campaignJobs)
    .where(and(...conditions))
    .orderBy(asc(campaignJobs.dueAt))
    .limit(limit);
  const claims = candidates.map((candidate) => ({ id: candidate.id, leaseId: uuidv7() }));
  if (claims.length === 0) return [];
  const results = await kaenmaDatabase.batch(
    claims.map((claim) =>
      kaenmaDatabase
        .prepare(
          `UPDATE campaign_jobs
           SET status = 'leased', lease_id = ?, lease_until = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'
             AND (lease_until IS NULL OR lease_until < ?)`,
        )
        .bind(claim.leaseId, leaseUntil, now, claim.id, now),
    ),
  );
  return claims.filter((_, index) => results[index]?.meta.changes === 1);
}
