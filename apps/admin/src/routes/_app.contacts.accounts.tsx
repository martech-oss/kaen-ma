import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/contacts/accounts")({
  component: Outlet,
});
