import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { emailTemplateOptionsQueryOptions } from "@/features/automations/automation-api";
import { emailVariablesListQueryOptions } from "@/features/emails/email-api";
import { EmailTemplatesPage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/templates")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
      context.queryClient.ensureQueryData(emailVariablesListQueryOptions()),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailTemplatesRoute,
});

function EmailTemplatesRoute() {
  return <EmailTemplatesPage />;
}
