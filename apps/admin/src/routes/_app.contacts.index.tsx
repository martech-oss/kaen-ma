import { RouteError, RoutePending } from "@/components/route-status";
import {
  contactSearchDefaults,
  loadContactsPage,
  parseContactSearch,
} from "@/features/contacts/contact-api";
import {
  createFileRoute,
  type SearchSchemaInput,
  stripSearchParams,
} from "@tanstack/react-router";
import { ContactsPage } from "@/features/contacts/contacts-page";

export const Route = createFileRoute("/_app/contacts/")({
  validateSearch: (
    search: Partial<ReturnType<typeof parseContactSearch>> & SearchSchemaInput,
  ) => parseContactSearch(search),
  search: {
    middlewares: [stripSearchParams(contactSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps, abortController }) =>
    loadContactsPage(deps, abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ContactsRoute,
});

function ContactsRoute() {
  return (
    <ContactsPage
      initialData={Route.useLoaderData()}
      initialSearch={Route.useSearch()}
    />
  );
}
