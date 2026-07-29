import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnvironment } from "../env";
import { orpcRouter } from "./router";

const handler = new RPCHandler(orpcRouter, {
  interceptors: [
    onError((error) => {
      console.error(
        JSON.stringify({
          message: "oRPC request failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }),
  ],
});

export function createOrpcRequestHandler(adminApi: Hono<AppEnvironment>) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const { matched, response } = await handler.handle(
      context.req.raw,
      {
        prefix: "/api/rpc",
        context: {
          database: context.get("database"),
          requestId: context.get("requestId"),
          env: context.env,
          headers: context.req.raw.headers,
          method: context.req.method,
          executionContext: context.executionCtx,
          adminApiFetch: async (request) =>
            adminApi.fetch(request, context.env, context.executionCtx),
        },
      },
    );

    if (matched) {
      return context.newResponse(response.body, response);
    }

    await next();
  });
}
