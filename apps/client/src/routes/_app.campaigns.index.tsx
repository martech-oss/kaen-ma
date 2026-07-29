import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { CampaignsPage, type CampaignRow } from "@/features/campaigns/campaign-pages";
import { rpc } from "@/rpc";

export const Route = createFileRoute("/_app/campaigns/")({
  loader: async ({ abortController }) => {
    const response = await rpc<CampaignRow[]>("/campaigns", {
      signal: abortController.signal,
    });
    return response.data;
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CampaignsRoute,
});

function CampaignsRoute() {
  const campaigns = Route.useLoaderData();
  return <CampaignsPage campaigns={campaigns} />;
}
