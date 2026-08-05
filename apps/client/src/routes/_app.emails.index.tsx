import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/emails/")({
  beforeLoad: () => {
    throw redirect({ to: "/emails/templates" });
  },
});
