import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { automationsQueryOptions } from "@/features/automations/automation-api";
import {
  contactTrendQueryOptions,
  dashboardQueryOptions,
  dealSummaryQueryOptions,
  deliveryTrendQueryOptions,
} from "@/features/dashboard/dashboard-api";
import { DashboardPage } from "@/features/dashboard/dashboard-page";

export const Route = createFileRoute("/_app/dashboard")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(dashboardQueryOptions()),
      context.queryClient.ensureQueryData(deliveryTrendQueryOptions()),
      context.queryClient.ensureQueryData(contactTrendQueryOptions()),
      context.queryClient.ensureQueryData(dealSummaryQueryOptions()),
      context.queryClient.ensureQueryData(automationsQueryOptions()),
    ]),
  ...routeStatusComponents,
  component: DashboardPage,
});
