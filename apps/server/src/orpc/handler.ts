import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { createMiddleware } from "hono/factory";

import type { AppEnvironment } from "../env";
import { logError } from "../observability";
import { orpcRequestContext } from "./request-context";
import { orpcRouter } from "./router";

const handler = new RPCHandler(orpcRouter, {
  interceptors: [
    onError((error) => {
      logError("orpc.request_failed", error);
    }),
  ],
});

export function createOrpcRequestHandler() {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const { matched, response } = await handler.handle(context.req.raw, {
      prefix: "/api/rpc",
      context: orpcRequestContext(context),
    });

    if (matched) {
      return context.newResponse(response.body, response);
    }

    await next();
  });
}
