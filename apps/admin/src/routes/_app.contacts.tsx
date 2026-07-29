import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "../App";

export const Route = createFileRoute("/_app/contacts")({
  component: ContactsPage,
});
