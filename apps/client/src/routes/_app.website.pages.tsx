import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { LandingPagesPage } from "@/features/website/landing-pages-page";
import { loadLandingPages } from "@/features/website/website-api";

export const Route = createFileRoute("/_app/website/pages")({
  loader: async ({ abortController, context }) => ({
    items: await loadLandingPages(abortController.signal),
    workspaceSlug: context.workspace.slug,
  }),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: LandingPagesRoute,
});

function LandingPagesRoute() {
  const data = Route.useLoaderData();
  return <LandingPagesPage items={data.items} workspaceSlug={data.workspaceSlug} />;
}
