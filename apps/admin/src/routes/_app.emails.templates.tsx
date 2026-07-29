import { EmailTemplatesPage } from "@/features/emails";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/emails/templates")({
  component: EmailTemplatesPage,
});
