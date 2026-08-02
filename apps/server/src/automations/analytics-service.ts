import { and, count, eq } from "drizzle-orm";

import { automationEnrollments, deliveries, type KaenmaDatabase } from "@kaenma/database";

export interface CampaignAnalytics {
  enrollments: Array<{ status: string; count: number }>;
  deliveries: Array<{ status: string; count: number }>;
}

export async function getCampaignAnalytics(
  database: KaenmaDatabase,
  workspaceId: string,
  automationId: string,
): Promise<CampaignAnalytics> {
  const [enrollmentRows, deliveryRows] = await Promise.all([
    database.orm
      .select({ status: automationEnrollments.status, count: count() })
      .from(automationEnrollments)
      .where(
        and(
          eq(automationEnrollments.workspaceId, workspaceId),
          eq(automationEnrollments.automationId, automationId),
        ),
      )
      .groupBy(automationEnrollments.status),
    database.orm
      .select({ status: deliveries.status, count: count() })
      .from(deliveries)
      .innerJoin(
        automationEnrollments,
        and(
          eq(automationEnrollments.id, deliveries.enrollmentId),
          eq(automationEnrollments.workspaceId, deliveries.workspaceId),
        ),
      )
      .where(
        and(
          eq(deliveries.workspaceId, workspaceId),
          eq(automationEnrollments.automationId, automationId),
        ),
      )
      .groupBy(deliveries.status),
  ]);
  return { enrollments: enrollmentRows, deliveries: deliveryRows };
}
