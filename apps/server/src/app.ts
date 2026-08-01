import { Hono } from "hono";
import { cors } from "hono/cors";

import { createAuth } from "./auth/service";
import { registerEmailWebhookRoutes } from "./email/webhook-routes";
import { type AppEnvironment } from "./env";
import { apiError, requestContext } from "./middleware";
import { logError } from "./observability";
import { createOrpcRequestHandler } from "./orpc/handler";
import { createOpenApiRequestHandler, generateOpenApiDocument } from "./orpc/openapi-handler";
import { registerPublicRoutes } from "./public/routes";

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
app.use("/api/rpc/*", createOrpcRequestHandler());
app.use("/api/v1/*", createOpenApiRequestHandler());
app.get("/api/health", async (context) => {
  try {
    const result = await context
      .get("database")
      .prepare("SELECT COUNT(*) AS count FROM d1_migrations")
      .first<{ count: number }>();
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
registerEmailWebhookRoutes(app);
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
