import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { createQueryClient } from "@/lib/query-client";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = createQueryClient();
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadDelay: 80,
    defaultPendingMs: 300,
    defaultPendingMinMs: 200,
    defaultStructuralSharing: true,
    search: { strict: true },
    scrollRestoration: true,
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
