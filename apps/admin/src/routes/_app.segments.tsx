import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/segments")({
  beforeLoad: () => {
    throw redirect({ to: "/contacts/segments", replace: true });
  },
});
