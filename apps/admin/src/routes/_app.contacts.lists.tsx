import { createFileRoute } from "@tanstack/react-router";
import { ContactListsPage } from "../features/contact-resources";

export const Route = createFileRoute("/_app/contacts/lists")({
  component: ContactListsPage,
});
