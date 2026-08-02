import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { emailVariablesListQueryOptions } from "@/features/emails/email-api";
import { EmailVariablesPage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/variables")({
  loader: ({ context }) => context.queryClient.ensureQueryData(emailVariablesListQueryOptions()),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailVariablesRoute,
});

function EmailVariablesRoute() {
  return <EmailVariablesPage />;
}
