import { RouteError, RoutePending } from "@/components/route-status";
import {
  accountSearchDefaults,
  loadAccounts,
  type AccountSearch,
} from "@/features/accounts/account-api";
import {
  createFileRoute,
  type SearchSchemaInput,
  stripSearchParams,
} from "@tanstack/react-router";
import { AccountsPage } from "@/features/accounts/accounts-page";

export const Route = createFileRoute("/_app/contacts/accounts/")({
  validateSearch: (
    search: Partial<AccountSearch> & SearchSchemaInput,
  ): AccountSearch => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  search: {
    middlewares: [stripSearchParams(accountSearchDefaults)],
  },
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps, abortController }) =>
    loadAccounts(deps.q, abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: AccountsRoute,
});

function AccountsRoute() {
  const { q } = Route.useSearch();
  return <AccountsPage accounts={Route.useLoaderData()} initialQuery={q} />;
}
