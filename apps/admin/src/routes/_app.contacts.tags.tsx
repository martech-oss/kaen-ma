import { createFileRoute } from "@tanstack/react-router";
import { ContactTagsPage } from "../features/contact-resources";

export const Route = createFileRoute("/_app/contacts/tags")({
  component: ContactTagsPage,
});
