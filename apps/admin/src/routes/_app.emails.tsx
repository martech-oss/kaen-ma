import { createFileRoute } from "@tanstack/react-router";
import { EmailsPage } from "../App";

export const Route = createFileRoute("/_app/emails")({
  component: EmailsPage,
});
