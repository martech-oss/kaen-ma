import { createFileRoute } from "@tanstack/react-router";
import { CampaignBuilder } from "../App";

export const Route = createFileRoute("/_app/campaigns/$id")({
  component: CampaignRoute,
});

function CampaignRoute() {
  const { id } = Route.useParams();
  return <CampaignBuilder id={id} />;
}
