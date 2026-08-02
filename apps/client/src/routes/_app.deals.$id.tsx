import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { dealDetailQueryOptions, dealOptionsQueryOptions } from "@/features/deals/deal-api";
import { DealDetailPage } from "@/features/deals/deal-pages";

export const Route = createFileRoute("/_app/deals/$id")({
  loader: ({ params, context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(dealDetailQueryOptions(params.id)),
      context.queryClient.ensureQueryData(dealOptionsQueryOptions()),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DealDetailRoute,
});

function DealDetailRoute() {
  const { id } = Route.useParams();
  return <DealDetailPage dealId={id} />;
}
