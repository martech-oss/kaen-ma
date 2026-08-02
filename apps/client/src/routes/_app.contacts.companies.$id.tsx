import { createFileRoute } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import { CompanyDetailPage } from "@/features/companies/companies-page";
import {
  companyContactOptionsQueryOptions,
  companyQueryOptions,
} from "@/features/companies/company-api";

export const Route = createFileRoute("/_app/contacts/companies/$id")({
  loader: ({ params, context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(companyQueryOptions(params.id)),
      context.queryClient.ensureQueryData(companyContactOptionsQueryOptions()),
    ]),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CompanyDetailRoute,
});

function CompanyDetailRoute() {
  const { id } = Route.useParams();
  return <CompanyDetailPage companyId={id} />;
}
