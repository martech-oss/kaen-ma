import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  emailTemplateOptionsQueryOptions,
  segmentOptionsQueryOptions,
} from "@/features/automations/automation-api";
import {
  emailCampaignsListQueryOptions,
  emailTopicOptionsQueryOptions,
} from "@/features/emails/email-api";
import { EmailCampaignsPage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(emailCampaignsListQueryOptions()),
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
      context.queryClient.ensureQueryData(segmentOptionsQueryOptions()),
      context.queryClient.ensureQueryData(emailTopicOptionsQueryOptions()),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailCampaignsRoute,
});

function EmailCampaignsRoute() {
  return <EmailCampaignsPage />;
}
