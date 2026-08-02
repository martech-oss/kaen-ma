import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  automationDraftQueryOptions,
  emailTemplateOptionsQueryOptions,
  formOptionsQueryOptions,
  segmentOptionsQueryOptions,
} from "@/features/automations/automation-api";
import { AutomationBuilder } from "@/features/automations/automation-pages";

export const Route = createFileRoute("/_app/automations/$id")({
  loader: ({ params, context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(automationDraftQueryOptions(params.id)),
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
      context.queryClient.ensureQueryData(formOptionsQueryOptions()),
      context.queryClient.ensureQueryData(segmentOptionsQueryOptions()),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: AutomationRoute,
});

function AutomationRoute() {
  const { id } = Route.useParams();
  const { data: draft } = useSuspenseQuery(automationDraftQueryOptions(id));
  const { data: templates } = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const { data: forms } = useSuspenseQuery(formOptionsQueryOptions());
  const { data: segments } = useSuspenseQuery(segmentOptionsQueryOptions());
  return (
    <AutomationBuilder
      id={id}
      initialDraft={draft}
      options={{
        templates: templates.filter((template) => template.sendable),
        forms,
        segments,
      }}
    />
  );
}
