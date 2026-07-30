import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { CampaignBuilder } from "@/features/campaigns/campaign-pages";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_app/campaigns/$id")({
  loader: async ({ params, abortController }) => {
    const request = { signal: abortController.signal };
    const [draft, templates, forms, segments] = await Promise.all([
      orpc.campaigns.getDraft({ id: params.id }, request),
      orpc.emails.listTemplates({ archived: false }, request),
      orpc.website.listForms(undefined, request),
      orpc.emails.listSegmentOptions(undefined, request),
    ]);
    return {
      draft,
      options: {
        templates: templates.filter((template) => template.sendable),
        forms,
        segments,
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
