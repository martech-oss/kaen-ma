import { compileSegmentFilter } from "@kaenma/core";
import type { KaenmaDatabase } from "@kaenma/database";
import { segmentFilterSchema } from "@kaenma/shared/segments";

export async function updateSegmentMemberCount(
  database: KaenmaDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE segments
     SET member_count = (
       SELECT COUNT(*) FROM segment_memberships sm
       WHERE sm.workspace_id = segments.workspace_id AND sm.segment_id = segments.id
     ), updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
    )
    .bind(new Date().toISOString(), workspaceId, segmentId)
    .run();
}

export async function refreshSegmentMemberships(
  database: KaenmaDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<boolean> {
  const segment = await database
    .prepare(`SELECT kind, filter_ast FROM segments WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, segmentId)
    .first<{ kind: "static" | "dynamic"; filter_ast: string | null }>();
  if (!segment) return false;
  if (segment.kind === "static") {
    await updateSegmentMemberCount(database, workspaceId, segmentId);
    return true;
  }
  let rawFilter: unknown;
  try {
    rawFilter = segment.filter_ast ? JSON.parse(segment.filter_ast) : null;
  } catch {
    return false;
  }
  const parsed = segmentFilterSchema.safeParse(rawFilter);
  if (!parsed.success) return false;
  const compiled = compileSegmentFilter(workspaceId, parsed.data);
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `DELETE FROM segment_memberships
       WHERE workspace_id = ? AND segment_id = ? AND source = 'dynamic'`,
      )
      .bind(workspaceId, segmentId),
    database
      .prepare(
        `INSERT OR IGNORE INTO segment_memberships
       (workspace_id, segment_id, contact_id, source, joined_at)
       SELECT ?, ?, matched.id, 'dynamic', ?
       FROM (${compiled.sql}) matched
       WHERE matched.status != 'archived'`,
      )
      .bind(workspaceId, segmentId, now, ...compiled.params),
    database
      .prepare(
        `UPDATE segments
       SET member_count = (
         SELECT COUNT(*) FROM segment_memberships sm
         WHERE sm.workspace_id = segments.workspace_id AND sm.segment_id = segments.id
       ), evaluated_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ?`,
      )
      .bind(now, now, workspaceId, segmentId),
  ]);
  return true;
}
