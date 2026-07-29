import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/website/")({
  beforeLoad: () => {
    throw redirect({ to: "/website/forms", replace: true });
  },
});
