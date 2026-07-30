import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  CampaignsPage,
  type AutomationOptions,
  type CampaignRow,
} from "@/features/campaigns/campaign-pages";
import { rpc } from "@/rpc";

export const Route = createFileRoute("/_app/campaigns/")({
  loader: async ({ abortController }) => {
    const request = { signal: abortController.signal };
    const [campaigns, templates, forms, segments] = await Promise.all([
      rpc<CampaignRow[]>("/campaigns", request),
      rpc<AutomationOptions["templates"]>("/email-templates", request),
      rpc<AutomationOptions["forms"]>("/forms", request),
      rpc<AutomationOptions["segments"]>("/segments", request),
    ]);
    return {
      campaigns: campaigns.data,
      options: {
        templates: templates.data.filter((template) => template.current_version_id),
        forms: forms.data,
        segments: segments.data,
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
