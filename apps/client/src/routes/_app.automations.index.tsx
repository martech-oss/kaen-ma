import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  automationsQueryOptions,
  emailTemplateOptionsQueryOptions,
} from "@/features/automations/automation-api";
import { AutomationsPage } from "@/features/automations/automation-pages";

export const Route = createFileRoute("/_app/automations/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(automationsQueryOptions()),
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: AutomationsPage,
});
