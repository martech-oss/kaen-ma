import { RouteError, RoutePending } from "@/components/route-status";
import { loadEmailCampaigns } from "@/features/emails/email-api";
import { EmailCampaignsPage } from "@/features/emails/email-pages";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/emails/")({
  loader: ({ abortController }) => loadEmailCampaigns(abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EmailCampaignsRoute,
});

function EmailCampaignsRoute() {
  return <EmailCampaignsPage data={Route.useLoaderData()} />;
}
