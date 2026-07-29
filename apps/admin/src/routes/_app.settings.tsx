import { SettingsPage } from "@/features/settings/settings-page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { workspace } = Route.useRouteContext();
  return <SettingsPage workspace={workspace} />;
}
