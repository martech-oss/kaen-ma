import { ApiClientError } from "@/api";
import { RouteError, RoutePending } from "@/components/route-status";
import { AppShell } from "@/layouts/app-shell";
import { getCurrentSession } from "@/lib/auth-session";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await getCurrentSession();
    if (!session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
        replace: true,
      });
    }

    try {
      const workspace = await getCurrentWorkspace();
      return { session, workspace };
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "workspace_required"
      ) {
        throw redirect({ to: "/onboarding", replace: true });
      }
      throw error;
    }
  },
  pendingComponent: () => (
    <RoutePending label="ワークスペースを読み込んでいます…" />
  ),
  errorComponent: RouteError,
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { session } = Route.useRouteContext();
  return <AppShell user={session.user} />;
}
