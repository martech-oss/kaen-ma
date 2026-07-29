import { RouteError, RoutePending } from "@/components/route-status";
import { loadEmailTemplates } from "@/features/emails/email-api";
import { EmailTemplatesPage } from "@/features/emails/email-pages";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/emails/templates")({
  loader: ({ abortController }) => loadEmailTemplates(abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailTemplatesRoute,
});

function EmailTemplatesRoute() {
  return <EmailTemplatesPage data={Route.useLoaderData()} />;
}
