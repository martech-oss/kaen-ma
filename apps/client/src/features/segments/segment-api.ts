import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

import { orpc, orpcQuery } from "@/lib/orpc";
import type { SegmentFilter } from "@openengage/core/segments";

export function segmentsQueryOptions() {
  return orpcQuery.segments.list.queryOptions();
}

export function invalidateSegmentsList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: orpcQuery.segments.list.key() });
}

export function createDynamicSegment(input: { name: string; slug: string; filter: SegmentFilter }) {
  return orpc.segments.create({ ...input, kind: "dynamic" });
}

export function useCreateSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.segments.create.mutationOptions(),
    onSuccess: () => invalidateSegmentsList(queryClient),
  });
}

export function refreshSegment(segmentId: string) {
  return orpc.segments.refresh({ id: segmentId });
}
