import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { SiteMessagesPage } from "@/features/website/site-messages-page";
import { siteMessagesQueryOptions } from "@/features/website/website-api";

export const Route = createFileRoute("/_app/website/messages")({
  loader: ({ context }) => context.queryClient.ensureQueryData(siteMessagesQueryOptions()),
  ...routeStatusComponents,
  component: SiteMessagesPage,
});
