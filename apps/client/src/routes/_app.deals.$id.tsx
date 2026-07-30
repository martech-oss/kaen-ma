import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { loadDealDetailWorkspace } from "@/features/deals/deal-api";
import { DealDetailPage } from "@/features/deals/deal-pages";

export const Route = createFileRoute("/_app/deals/$id")({
  loader: ({ params, abortController }) =>
    loadDealDetailWorkspace(params.id, abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DealDetailRoute,
});

function DealDetailRoute() {
  const { id } = Route.useParams();
  return <DealDetailPage dealId={id} initialData={Route.useLoaderData()} />;
}
