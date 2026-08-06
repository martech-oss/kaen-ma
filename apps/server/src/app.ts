import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { registerAgentGatewayRoutes } from "./agents/gateway";
import { apiError, requestContext } from "./auth/access";
import { createAuth } from "./auth/service";
import { type AppEnvironment } from "./env";
import { registerMcpRoutes } from "./mcp/handler";
import { logError } from "./observability";
import { createOrpcRequestHandler } from "./orpc/handler";
import { createOpenApiRequestHandler, generateOpenApiDocument } from "./orpc/openapi-handler";
import { registerPublicRoutes } from "./public/routes";
import { registerAssetRoutes } from "./web/asset-routes";

const app = new Hono<AppEnvironment>();
app.use("*", requestContext);
app.use(
  "/api/public/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);
app.on(["GET", "POST"], "/api/auth/*", (context) => {
  const requestOrigin = new URL(context.req.url).origin;
  return createAuth(context.env, requestOrigin).handler(context.req.raw);
});
registerMcpRoutes(app);
app.use("/api/rpc/*", createOrpcRequestHandler());
app.use("/api/v1/*", createOpenApiRequestHandler());
app.get("/api/health", async (context) => {
  try {
    // d1_migrations is Wrangler-managed, outside our Drizzle schema, so this
    // is a raw tagged-template query rather than a schema table reference.
    const result = await context
      .get("database")
      .first<{ count: number }>(sql`SELECT COUNT(*) AS count FROM d1_migrations`);
    return context.json({
      data: {
        status: "ok",
        service: context.env.APP_NAME,
        environment: context.env.ENVIRONMENT,
        migrations: result?.count ?? 0,
      },
    });
  } catch (error) {
    return apiError(
      context,
      503,
      "database_unavailable",
      "D1へ接続できません",
      error instanceof Error ? error.message : String(error),
    );
  }
});
app.get("/api/openapi.json", async (context) =>
  context.json(await generateOpenApiDocument(context.env.APP_URL)),
);
registerAgentGatewayRoutes(app);
registerAssetRoutes(app);
registerPublicRoutes(app);
app.notFound((context) => apiError(context, 404, "not_found", "リソースが見つかりません"));
app.onError((error, context) => {
  logError("request.unhandled", error, {
    requestId: context.get("requestId"),
    method: context.req.method,
    path: context.req.path,
  });
  return apiError(context, 500, "internal_error", "処理中にエラーが発生しました");
});
export { app };
