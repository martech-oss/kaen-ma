import { and, count, eq } from "drizzle-orm";

import { campaignEnrollments, deliveries, type KaenmaDatabase } from "@kaenma/database";

export interface CampaignAnalytics {
  enrollments: Array<{ status: string; count: number }>;
  deliveries: Array<{ status: string; count: number }>;
}

export async function getCampaignAnalytics(
  database: KaenmaDatabase,
  workspaceId: string,
  campaignId: string,
): Promise<CampaignAnalytics> {
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
        and(eq(deliveries.workspaceId, workspaceId), eq(campaignEnrollments.campaignId, campaignId)),
      )
      .groupBy(deliveries.status),
  ]);
  return { enrollments: enrollmentRows, deliveries: deliveryRows };
}
