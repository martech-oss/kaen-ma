import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { CampaignBuilder } from "@/features/campaigns/campaign-pages";
import { rpc } from "@/rpc";
import type { CampaignDefinition } from "@kaenma/shared";

export const Route = createFileRoute("/_app/campaigns/$id")({
  loader: async ({ params, abortController }) => {
    const response = await rpc<{ graph: CampaignDefinition }>(`/campaigns/${params.id}/draft`, {
      signal: abortController.signal,
    });
    return response.data.graph;
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CampaignRoute,
});

function CampaignRoute() {
  const { id } = Route.useParams();
  const definition = Route.useLoaderData();
  return <CampaignBuilder id={id} initialDefinition={definition} />;
}
