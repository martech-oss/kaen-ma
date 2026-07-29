import { api } from "@/api";
import { RouteError, RoutePending } from "@/components/route-status";
import {
  CampaignsPage,
  type CampaignRow,
} from "@/features/campaigns/campaign-pages";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/campaigns/")({
  loader: async ({ abortController }) => {
    const response = await api<CampaignRow[]>("/campaigns", {
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
