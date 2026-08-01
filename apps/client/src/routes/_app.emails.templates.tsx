import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { emailTemplatesQueryOptions } from "@/features/emails/email-api";
import { EmailTemplatesPage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/templates")({
  loader: ({ context }) => context.queryClient.ensureQueryData(emailTemplatesQueryOptions()),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailTemplatesRoute,
});

function EmailTemplatesRoute() {
  return <EmailTemplatesPage />;
}
