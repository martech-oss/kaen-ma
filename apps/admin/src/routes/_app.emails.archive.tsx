import { EmailArchivePage } from "@/features/emails";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/emails/archive")({
  component: EmailArchivePage,
});
