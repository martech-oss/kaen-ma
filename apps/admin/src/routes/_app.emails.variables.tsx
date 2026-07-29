import { RouteError, RoutePending } from "@/components/route-status";
import { loadEmailVariables } from "@/features/emails/email-api";
import { EmailVariablesPage } from "@/features/emails/email-pages";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/emails/variables")({
  loader: ({ abortController }) => loadEmailVariables(abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailVariablesRoute,
});

function EmailVariablesRoute() {
  return <EmailVariablesPage data={Route.useLoaderData()} />;
}
