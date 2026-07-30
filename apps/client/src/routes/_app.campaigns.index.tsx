import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { CampaignsPage } from "@/features/campaigns/campaign-pages";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_app/campaigns/")({
  loader: async ({ abortController }) => {
    const request = { signal: abortController.signal };
    const [campaigns, templates, forms, segments] = await Promise.all([
      orpc.campaigns.list(undefined, request),
      orpc.emails.listTemplates({ archived: false }, request),
      orpc.website.listForms(undefined, request),
      orpc.emails.listSegmentOptions(undefined, request),
    ]);
    return {
      campaigns,
      options: {
        templates: templates.filter((template) => template.sendable),
        forms,
        segments,
      },
    };
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CampaignsRoute,
});

function CampaignsRoute() {
  const data = Route.useLoaderData();
  return <CampaignsPage campaigns={data.campaigns} options={data.options} />;
}
