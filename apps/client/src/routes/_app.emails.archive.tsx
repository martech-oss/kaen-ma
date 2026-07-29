import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { loadEmailArchive } from "@/features/emails/email-api";
import { EmailArchivePage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/archive")({
  loader: ({ abortController }) => loadEmailArchive(abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailArchiveRoute,
});

function EmailArchiveRoute() {
  return <EmailArchivePage data={Route.useLoaderData()} />;
}
