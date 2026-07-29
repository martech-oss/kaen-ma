import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { SiteTrackingPage } from "@/features/website/site-tracking-page";
import { loadSiteTracking } from "@/features/website/website-api";

export const Route = createFileRoute("/_app/website/tracking")({
  loader: ({ abortController }) => loadSiteTracking(abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: SiteTrackingRoute,
});

function SiteTrackingRoute() {
  return <SiteTrackingPage data={Route.useLoaderData()} />;
}
