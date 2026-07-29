import { rpc } from "@/rpc";
import { RouteError, RoutePending } from "@/components/route-status";
import {
  DashboardPage,
  type DashboardData,
} from "@/features/dashboard/dashboard-page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/dashboard")({
  loader: async ({ abortController }) => {
    const response = await rpc<DashboardData>("/dashboard", {
      signal: abortController.signal,
    });
    return response.data;
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DashboardRoute,
});

function DashboardRoute() {
  const data = Route.useLoaderData();
  return <DashboardPage data={data} />;
}
