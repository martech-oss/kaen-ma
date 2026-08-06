import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
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
  ...routeStatusComponents,
  component: DashboardPage,
});
