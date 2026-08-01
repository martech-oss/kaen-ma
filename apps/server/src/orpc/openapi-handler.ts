import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import {
  experimental_ZodSmartCoercionPlugin as ZodSmartCoercionPlugin,
  ZodToJsonSchemaConverter,
} from "@orpc/zod/zod4";
import { createMiddleware } from "hono/factory";

import { contract } from "@kaenma/orpc";

import type { AppEnvironment } from "../env";
import { logError } from "../observability";
import { orpcRouter } from "./router";

/**
 * Serves the same procedures as /api/rpc through their .route() metadata,
 * giving SDK/MCP/external integrations a stable REST surface at /api/v1.
 */
const handler = new OpenAPIHandler(orpcRouter, {
  // Query strings arrive as text; coerce them into the schema's declared
  // number/boolean/date types so GET /contacts?scoreMin=50 works.
  plugins: [new ZodSmartCoercionPlugin()],
  interceptors: [
    onError((error) => {
      logError("openapi.request_failed", error);
    }),
  ],
});

export function createOpenApiRequestHandler() {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const { matched, response } = await handler.handle(context.req.raw, {
      prefix: "/api/v1",
      context: {
        database: context.get("database"),
        requestId: context.get("requestId"),
        env: context.env,
        headers: context.req.raw.headers,
        method: context.req.method,
        executionContext: context.executionCtx,
      },
    });

    if (matched) {
      return context.newResponse(response.body, response);
    }

    await next();
  });
}

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

let cachedDocument: Promise<object> | undefined;

export function generateOpenApiDocument(appUrl: string): Promise<object> {
  cachedDocument ??= generator.generate(contract, {
    info: {
      title: "Kaenma API",
      version: "0.1.0",
      description: "Cloudflare-native open source marketing automation",
    },
    servers: [{ url: new URL("/api/v1", appUrl).toString() }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Workspace API key (kaenma_<prefix>_<secret>)",
        },
      },
    },
  });
  return cachedDocument;
}
