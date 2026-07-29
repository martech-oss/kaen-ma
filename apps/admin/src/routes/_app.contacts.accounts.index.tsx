import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "../features/accounts";

export const Route = createFileRoute("/_app/contacts/accounts/")({
  component: AccountsPage,
});
