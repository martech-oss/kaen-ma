import { createFileRoute } from "@tanstack/react-router";
import { CampaignsPage } from "../App";

export const Route = createFileRoute("/_app/campaigns/")({
  component: CampaignsPage,
});
