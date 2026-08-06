import type { Context } from "hono";

import type { AppEnvironment } from "../env";
import type { OrpcInitialContext } from "./context";

/** Builds the oRPC request context shared by the RPC and OpenAPI handlers. */
export function orpcRequestContext(context: Context<AppEnvironment>): OrpcInitialContext {
  return {
    database: context.get("database"),
    requestId: context.get("requestId"),
    env: context.env,
    headers: context.req.raw.headers,
    method: context.req.method,
    executionContext: context.executionCtx,
  };
}
