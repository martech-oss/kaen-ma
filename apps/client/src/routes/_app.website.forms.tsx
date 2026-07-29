import { RouteError, RoutePending } from "@/components/route-status";
import { SignupFormsPage } from "@/features/website/signup-forms-page";
import { loadSignupForms } from "@/features/website/website-api";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/website/forms")({
  loader: async ({ abortController, context }) => ({
    items: await loadSignupForms(abortController.signal),
    workspaceSlug: context.workspace.slug,
  }),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: SignupFormsRoute,
});

function SignupFormsRoute() {
  const data = Route.useLoaderData();
  return (
    <SignupFormsPage
      items={data.items}
      workspaceSlug={data.workspaceSlug}
    />
  );
}
