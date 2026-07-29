import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "../App";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});
