import { RouteError, RoutePending } from "@/components/route-status";
import { loadAccountDetail } from "@/features/accounts/account-api";
import { createFileRoute } from "@tanstack/react-router";
import { AccountDetailPage } from "@/features/accounts/accounts-page";

export const Route = createFileRoute("/_app/contacts/accounts/$id")({
  loader: ({ params, abortController }) =>
    loadAccountDetail(params.id, abortController.signal),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: AccountDetailRoute,
});

function AccountDetailRoute() {
  const { id } = Route.useParams();
  return (
    <AccountDetailPage accountId={id} initialData={Route.useLoaderData()} />
  );
}
