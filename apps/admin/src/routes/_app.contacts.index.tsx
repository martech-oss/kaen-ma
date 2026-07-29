import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "../features/contacts";

export const Route = createFileRoute("/_app/contacts/")({
  component: ContactsPage,
});
