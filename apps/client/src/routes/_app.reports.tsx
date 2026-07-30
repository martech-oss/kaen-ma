import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { RouteError, RoutePending } from "@/components/route-status";
import {
  loadReportWorkspace,
  reportSearchDefaults,
  type ReportSearch,
  type ReportView,
} from "@/features/reports/report-api";
import { ReportsPage } from "@/features/reports/report-pages";

export const Route = createFileRoute("/_app/reports")({
  validateSearch: (search: Partial<ReportSearch> & SearchSchemaInput): ReportSearch => ({
    view: isReportView(search.view) ? search.view : "overview",
    from: isIsoDate(search.from) ? search.from : reportSearchDefaults.from,
    to: isIsoDate(search.to) ? search.to : reportSearchDefaults.to,
    currency: typeof search.currency === "string" ? search.currency : "",
  }),
  search: {
    middlewares: [stripSearchParams(reportSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps, abortController }) => loadReportWorkspace(deps, abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ReportsRoute,
});

function ReportsRoute() {
  return <ReportsPage data={Route.useLoaderData()} search={Route.useSearch()} />;
}

function isReportView(value: unknown): value is ReportView {
  return (
    value === "overview" ||
    value === "contacts" ||
    value === "automations" ||
    value === "emails" ||
    value === "deals" ||
    value === "site"
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
