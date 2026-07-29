import startHandler from "@tanstack/react-start/server-entry";

import { app } from "../../server/src/app";
import { email } from "../../server/src/email";
import type { RuntimeEnv } from "../../server/src/env";
import { queue, scheduled } from "../../server/src/runtime";

const backendPrefixes = ["/api", "/f", "/p", "/t", "/u", "/preference"] as const;

function isBackendRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return backendPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default {
  fetch(request: Request, env: RuntimeEnv, context: ExecutionContext) {
    if (isBackendRequest(request)) {
      return app.fetch(request, env, context);
    }
    return startHandler.fetch(request);
  },
  scheduled,
  queue,
  email,
} satisfies ExportedHandler<RuntimeEnv>;
