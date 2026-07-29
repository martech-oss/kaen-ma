import { RouteError, RoutePending } from "@/components/route-status";
import { SiteMessagesPage } from "@/features/website/site-messages-page";
import { loadSiteMessages } from "@/features/website/website-api";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/website/messages")({
  loader: ({ abortController }) => loadSiteMessages(abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: SiteMessagesRoute,
});

function SiteMessagesRoute() {
  return <SiteMessagesPage items={Route.useLoaderData()} />;
}
