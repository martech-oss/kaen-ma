import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  CampaignBuilder,
  type AutomationOptions,
  type CampaignDraft,
} from "@/features/campaigns/campaign-pages";
import { rpc } from "@/rpc";

export const Route = createFileRoute("/_app/campaigns/$id")({
  loader: async ({ params, abortController }) => {
    const request = { signal: abortController.signal };
    const [draft, templates, forms, segments] = await Promise.all([
      rpc<CampaignDraft>(`/campaigns/${params.id}/draft`, request),
      rpc<AutomationOptions["templates"]>("/email-templates", request),
      rpc<AutomationOptions["forms"]>("/forms", request),
      rpc<AutomationOptions["segments"]>("/segments", request),
    ]);
    return {
      draft: draft.data,
      options: {
        templates: templates.data.filter((template) => template.sendable),
        forms: forms.data,
        segments: segments.data,
      },
    };
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CampaignRoute,
});

function CampaignRoute() {
  const { id } = Route.useParams();
  const data = Route.useLoaderData();
  return <CampaignBuilder id={id} initialDraft={data.draft} options={data.options} />;
}
