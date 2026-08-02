import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  dashboardQueryOptions,
  deliveryTrendQueryOptions,
} from "@/features/dashboard/dashboard-api";
import { DashboardPage } from "@/features/dashboard/dashboard-page";

export const Route = createFileRoute("/_app/dashboard")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(dashboardQueryOptions()),
      context.queryClient.ensureQueryData(deliveryTrendQueryOptions()),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DashboardPage,
});
