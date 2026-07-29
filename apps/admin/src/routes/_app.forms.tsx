import { api } from "@/api";
import { RouteError, RoutePending } from "@/components/route-status";
import { FormsPage, type FormRow } from "@/features/forms/forms-page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/forms")({
  loader: async ({ abortController }) => {
    const response = await api<FormRow[]>("/forms", {
      signal: abortController.signal,
    });
    return response.data;
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: FormsRoute,
});

function FormsRoute() {
  const items = Route.useLoaderData();
  return <FormsPage items={items} />;
}
