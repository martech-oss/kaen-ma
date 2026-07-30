import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_app/dashboard")({
  loader: async ({ abortController }) => {
    return orpc.operations.dashboard(undefined, { signal: abortController.signal });
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DashboardRoute,
});

function DashboardRoute() {
  const data = Route.useLoaderData();
  return <DashboardPage data={data} />;
}
