import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { SignupFormsPage } from "@/features/website/signup-forms-page";
import { signupFormsQueryOptions } from "@/features/website/website-api";

export const Route = createFileRoute("/_app/website/forms")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(signupFormsQueryOptions());
    return { workspaceSlug: context.workspace.slug };
  },
  ...routeStatusComponents,
  component: SignupFormsRoute,
});

function SignupFormsRoute() {
  const { workspaceSlug } = Route.useLoaderData();
  return <SignupFormsPage workspaceSlug={workspaceSlug} />;
}
