import { orpcQuery } from "@/lib/orpc";

export function segmentsQueryOptions() {
  return orpcQuery.segments.list.queryOptions();
}
