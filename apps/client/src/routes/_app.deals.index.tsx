import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  dealOptionsQueryOptions,
  dealSearchDefaults,
  dealsQueryOptions,
  type DealSearch,
} from "@/features/deals/deal-api";
import { DealsPage } from "@/features/deals/deal-pages";

export const Route = createFileRoute("/_app/deals/")({
  validateSearch: (search: Partial<DealSearch> & SearchSchemaInput): DealSearch => ({
    pipelineId: typeof search.pipelineId === "string" ? search.pipelineId : "",
    status: isDealStatus(search.status) ? search.status : "open",
    q: typeof search.q === "string" ? search.q : "",
  }),
  search: {
    middlewares: [stripSearchParams(dealSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps, context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(dealOptionsQueryOptions()),
      context.queryClient.ensureQueryData(dealsQueryOptions(deps)),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DealsRoute,
});

function DealsRoute() {
  return <DealsPage search={Route.useSearch()} />;
}

function isDealStatus(value: unknown): value is DealSearch["status"] {
  return value === "open" || value === "won" || value === "lost" || value === "all";
}
