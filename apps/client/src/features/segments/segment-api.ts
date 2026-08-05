import type { SegmentFilter } from "@openengage/core/segments";

import { orpc, orpcQuery } from "@/lib/orpc";

export function segmentsQueryOptions() {
  return orpcQuery.segments.list.queryOptions();
}

export function createDynamicSegment(input: { name: string; slug: string; filter: SegmentFilter }) {
  return orpc.segments.create({ ...input, kind: "dynamic" });
}

export function refreshSegment(segmentId: string) {
  return orpc.segments.refresh({ id: segmentId });
}
