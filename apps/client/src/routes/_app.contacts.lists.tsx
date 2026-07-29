import { RouteError, RoutePending } from "@/components/route-status";
import { loadContactResources } from "@/features/contacts/contact-resource-api";
import { createFileRoute } from "@tanstack/react-router";
import { ContactListsPage } from "@/features/contacts/contact-resource-pages";

export const Route = createFileRoute("/_app/contacts/lists")({
  loader: ({ abortController }) => loadContactResources(abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ContactListsRoute,
});

function ContactListsRoute() {
  return <ContactListsPage initialResources={Route.useLoaderData()} />;
}
