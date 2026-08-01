import { and, count, eq } from "drizzle-orm";
import type { Hono } from "hono";

import { campaignEnrollments, deliveries } from "@kaenma/database";

import type { AppEnvironment } from "../env";
import { requireRole } from "../middleware";

export function registerAnalyticsRoutes(api: Hono<AppEnvironment>): void {
  api.get("/analytics/campaigns/:id", requireRole("analyst"), async (context) => {
    const database = context.get("database");
    const workspaceId = context.get("workspace").workspaceId;
    const campaignId = context.req.param("id");
    const [enrollmentRows, deliveryRows] = await Promise.all([
      database.orm
        .select({ status: campaignEnrollments.status, count: count() })
        .from(campaignEnrollments)
        .where(
          and(
            eq(campaignEnrollments.workspaceId, workspaceId),
            eq(campaignEnrollments.campaignId, campaignId),
          ),
        )
        .groupBy(campaignEnrollments.status),
      database.orm
        .select({ status: deliveries.status, count: count() })
        .from(deliveries)
        .innerJoin(
          campaignEnrollments,
          and(
            eq(campaignEnrollments.id, deliveries.enrollmentId),
            eq(campaignEnrollments.workspaceId, deliveries.workspaceId),
          ),
        )
        .where(
          and(
            eq(deliveries.workspaceId, workspaceId),
            eq(campaignEnrollments.campaignId, campaignId),
          ),
        )
        .groupBy(deliveries.status),
    ]);
    return context.json({
      data: {
        enrollments: enrollmentRows,
        deliveries: deliveryRows,
      },
    });
  });
}
