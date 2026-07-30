import type { Hono } from "hono";

import type { AppEnvironment } from "../env";
import { requireRole } from "../middleware";

export function registerAnalyticsRoutes(api: Hono<AppEnvironment>): void {
  api.get("/analytics/campaigns/:id", requireRole("analyst"), async (context) => {
    const database = context.get("database");
    const workspaceId = context.get("workspace").workspaceId;
    const [enrollments, deliveries] = await database.batch([
      database
        .prepare(
          `SELECT status, COUNT(*) AS count FROM campaign_enrollments
           WHERE workspace_id = ? AND campaign_id = ? GROUP BY status`,
        )
        .bind(workspaceId, context.req.param("id")),
      database
        .prepare(
          `SELECT d.status, COUNT(*) AS count FROM deliveries d
           JOIN campaign_enrollments ce
             ON ce.id = d.enrollment_id AND ce.workspace_id = d.workspace_id
           WHERE d.workspace_id = ? AND ce.campaign_id = ? GROUP BY d.status`,
        )
        .bind(workspaceId, context.req.param("id")),
    ]);
    return context.json({
      data: {
        enrollments: enrollments?.results ?? [],
        deliveries: deliveries?.results ?? [],
      },
    });
  });
}
