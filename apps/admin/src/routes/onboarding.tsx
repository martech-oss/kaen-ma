import { ApiClientError } from "@/api";
import { RouteError, RoutePending } from "@/components/route-status";
import { WorkspaceSetupPage } from "@/features/auth/auth-pages";
import { getCurrentSession } from "@/lib/auth-session";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding")({
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
      await getCurrentWorkspace();
      throw redirect({ to: "/dashboard", replace: true });
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "workspace_required"
      ) {
        return;
      }
      throw error;
    }
  },
  pendingComponent: () => (
    <RoutePending label="ワークスペースを確認しています…" />
  ),
  errorComponent: RouteError,
  component: WorkspaceSetupPage,
});
