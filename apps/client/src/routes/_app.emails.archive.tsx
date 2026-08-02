import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  emailArchivedCampaignsQueryOptions,
  emailArchivedTemplatesQueryOptions,
} from "@/features/emails/email-api";
import { EmailArchivePage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/archive")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(emailArchivedCampaignsQueryOptions()),
      context.queryClient.ensureQueryData(emailArchivedTemplatesQueryOptions()),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailArchiveRoute,
});

function EmailArchiveRoute() {
  return <EmailArchivePage />;
}
