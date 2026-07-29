import { RouteError, RoutePending } from "@/components/route-status";
import { loadContactResources } from "@/features/contacts/contact-resource-api";
import { createFileRoute } from "@tanstack/react-router";
import { ContactTagsPage } from "@/features/contacts/contact-resource-pages";

export const Route = createFileRoute("/_app/contacts/tags")({
  loader: ({ abortController }) => loadContactResources(abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ContactTagsRoute,
});

function ContactTagsRoute() {
  return <ContactTagsPage initialResources={Route.useLoaderData()} />;
}
