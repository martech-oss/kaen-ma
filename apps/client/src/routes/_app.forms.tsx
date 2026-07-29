import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/forms")({
  beforeLoad: () => {
    throw redirect({ to: "/website/forms", replace: true });
  },
});
