import { Hono } from "hono";
import { cors } from "hono/cors";

import { createDatabase } from "@kaenma/database";
import { createOpenApiDocument } from "@kaenma/shared/openapi";

import { registerAccountRoutes } from "./accounts/routes";
import { registerAnalyticsRoutes } from "./analytics/routes";
import { registerAssetRoutes } from "./assets/routes";
import { createAuth } from "./auth/service";
import { registerBroadcastRoutes } from "./broadcasts/routes";
import { registerCampaignRoutes } from "./campaigns/routes";
import { registerConsentRoutes } from "./consent/routes";
import { registerContactManagementRoutes } from "./contacts/management-routes";
import { registerContactRoutes } from "./contacts/routes";
import { registerDealRoutes } from "./deals/routes";
import { registerEmailWebhookRoutes } from "./email/webhook-routes";
import { type AppEnvironment } from "./env";
import { registerFormRoutes } from "./forms/routes";
import { registerIntegrationRoutes } from "./integrations/routes";
import { registerMessageVariableRoutes } from "./message-variables/routes";
import { apiError, requestContext, requireWorkspace } from "./middleware";
import { logError } from "./observability";
import { registerOperationsRoutes } from "./operations/routes";
import { createOrpcRequestHandler } from "./orpc/handler";
import { registerPageRoutes } from "./pages/routes";
import { registerProjectRoutes } from "./projects/routes";
import { registerPublicRoutes } from "./public/routes";
import { registerReportRoutes } from "./reports/routes";
import { registerSegmentRoutes } from "./segments/routes";
import { registerTemplateRoutes } from "./templates/routes";
import { registerWebsiteRoutes } from "./website/routes";
import { registerWorkspaceRoutes } from "./workspaces/routes";

const app = new Hono<AppEnvironment>();
const adminApi = createApi();
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
app.get("/api/openapi.json", (context) => context.json(createOpenApiDocument(context.env.APP_URL)));
registerEmailWebhookRoutes(app);
app.route("/api/v1", adminApi);
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
function createApi(): Hono<AppEnvironment> {
  const api = new Hono<AppEnvironment>();
  api.use("*", async (context, next) => {
    if (!context.get("database")) {
      context.set("database", createDatabase(context.env.DB));
    }
    if (!context.get("requestId")) {
      context.set("requestId", context.req.header("cf-ray") ?? crypto.randomUUID());
    }
    await next();
  });
  api.use("*", requireWorkspace);

  registerWorkspaceRoutes(api);
  registerContactRoutes(api);

  registerAccountRoutes(api);
  registerDealRoutes(api);
  registerContactManagementRoutes(api);
  registerSegmentRoutes(api);
  registerTemplateRoutes(api);
  registerMessageVariableRoutes(api);
  registerCampaignRoutes(api);
  registerBroadcastRoutes(api);
  registerFormRoutes(api);
  registerWebsiteRoutes(api);
  registerAssetRoutes(api);
  registerProjectRoutes(api);
  registerPageRoutes(api);
  registerConsentRoutes(api);
  registerIntegrationRoutes(api);
  registerAnalyticsRoutes(api);
  registerReportRoutes(api);
  registerOperationsRoutes(api);
  return api;
}
