import { rpc } from "@/rpc";
import { RouteError, RoutePending } from "@/components/route-status";
import {
  SegmentsPage,
  type SegmentRow,
} from "@/features/segments/segments-page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/contacts/segments")({
  loader: async ({ abortController }) => {
    const response = await rpc<SegmentRow[]>("/segments", {
      signal: abortController.signal,
    });
    return response.data;
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: SegmentsRoute,
});

function SegmentsRoute() {
  const segments = Route.useLoaderData();
  return <SegmentsPage segments={segments} />;
}
