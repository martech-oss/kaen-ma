import { compileSegmentFilter } from "@openengage/core/segments";
import { SegmentRepository, type OpenEngageDatabase } from "@openengage/database";

/** These helpers are called from flows that only carry a workspace id (bulk contact actions, membership refreshes). */
function segmentRepository(database: OpenEngageDatabase, workspaceId: string): SegmentRepository {
  return new SegmentRepository(database, { workspaceId });
}

export async function updateSegmentMemberCount(
  database: OpenEngageDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<void> {
  await segmentRepository(database, workspaceId).updateMemberCount(segmentId);
}

export async function refreshSegmentMemberships(
  database: OpenEngageDatabase,
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
  if (!segment.filterAst) return false;
  const compiled = compileSegmentFilter(workspaceId, segment.filterAst);
  await repository.replaceDynamicMemberships(segmentId, compiled);
  return true;
}
