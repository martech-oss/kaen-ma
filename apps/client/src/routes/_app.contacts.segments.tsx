import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { segmentsQueryOptions } from "@/features/segments/segment-api";
import { SegmentsPage } from "@/features/segments/segments-page";

export const Route = createFileRoute("/_app/contacts/segments")({
  loader: ({ context }) => context.queryClient.ensureQueryData(segmentsQueryOptions()),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: SegmentsPage,
});
