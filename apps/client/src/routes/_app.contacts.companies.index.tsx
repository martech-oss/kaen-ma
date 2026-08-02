import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { CompaniesPage } from "@/features/companies/companies-page";
import {
  companiesQueryOptions,
  companySearchDefaults,
  type CompanySearch,
} from "@/features/companies/company-api";

export const Route = createFileRoute("/_app/contacts/companies/")({
  validateSearch: (search: Partial<CompanySearch> & SearchSchemaInput): CompanySearch => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  search: {
    middlewares: [stripSearchParams(companySearchDefaults)],
  },
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps, context }) => context.queryClient.ensureQueryData(companiesQueryOptions(deps.q)),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CompaniesRoute,
});

function CompaniesRoute() {
  const { q } = Route.useSearch();
  return <CompaniesPage initialQuery={q} />;
}
