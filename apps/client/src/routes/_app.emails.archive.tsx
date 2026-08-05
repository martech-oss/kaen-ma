import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { emailArchivedTemplatesQueryOptions } from "@/features/emails/email-api";
import { EmailArchivePage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/archive")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(emailArchivedTemplatesQueryOptions()),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailArchiveRoute,
});

function EmailArchiveRoute() {
  return <EmailArchivePage />;
}
