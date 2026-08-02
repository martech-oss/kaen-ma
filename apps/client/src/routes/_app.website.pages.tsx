import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { LandingPagesPage } from "@/features/website/landing-pages-page";
import { landingPagesQueryOptions } from "@/features/website/website-api";

export const Route = createFileRoute("/_app/website/pages")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(landingPagesQueryOptions());
    return { workspaceSlug: context.workspace.slug };
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: LandingPagesRoute,
});

function LandingPagesRoute() {
  const { workspaceSlug } = Route.useLoaderData();
  return <LandingPagesPage workspaceSlug={workspaceSlug} />;
}
