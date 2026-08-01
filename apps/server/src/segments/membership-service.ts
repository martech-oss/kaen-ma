import { compileSegmentFilter } from "@kaenma/core";
import { SegmentRepository, type KaenmaDatabase } from "@kaenma/database";
import { segmentFilterSchema } from "@kaenma/orpc";

/**
 * These helpers are called from flows that only carry a workspace id (bulk
 * contact actions, membership refreshes), so a minimal repository context is
 * synthesized here; the repository only reads `workspaceId` from it.
 */
function segmentRepository(database: KaenmaDatabase, workspaceId: string): SegmentRepository {
  return new SegmentRepository(database, { workspaceId, userId: "system", role: "owner" });
}

export async function updateSegmentMemberCount(
  database: KaenmaDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<void> {
  await segmentRepository(database, workspaceId).updateMemberCount(segmentId);
}

export async function refreshSegmentMemberships(
  database: KaenmaDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<boolean> {
  const repository = segmentRepository(database, workspaceId);
  const segment = await repository.findSegmentDefinition(segmentId);
  if (!segment) return false;
  if (segment.kind === "static") {
    await repository.updateMemberCount(segmentId);
    return true;
  }
  let rawFilter: unknown;
  try {
    rawFilter = segment.filterAst ? JSON.parse(segment.filterAst) : null;
  } catch {
    return false;
  }
  const parsed = segmentFilterSchema.safeParse(rawFilter);
  if (!parsed.success) return false;
  const compiled = compileSegmentFilter(workspaceId, parsed.data);
  await repository.replaceDynamicMemberships(segmentId, compiled);
  return true;
}
