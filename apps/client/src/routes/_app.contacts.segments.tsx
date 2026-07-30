import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { SegmentsPage } from "@/features/segments/segments-page";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_app/contacts/segments")({
  loader: async ({ abortController }) => {
    return orpc.segments.list(undefined, { signal: abortController.signal });
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: SegmentsRoute,
});

function SegmentsRoute() {
  const segments = Route.useLoaderData();
  return <SegmentsPage segments={segments} />;
}
