import { createFileRoute } from "@tanstack/react-router";
import { AccountDetailPage } from "../features/accounts";

export const Route = createFileRoute("/_app/contacts/accounts/$id")({
  component: AccountDetailRoute,
});

function AccountDetailRoute() {
  const { id } = Route.useParams();
  return <AccountDetailPage accountId={id} />;
}
