import { ReportsRepository } from "@openengage/database";

import { primitiveString } from "../platform/values";
import { publicRange, rate, type ReportDatabase, type ReportRange, toNumber } from "./shared";

export async function emailReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const data = await new ReportsRepository(database).emailsSummary(workspaceId, range);
  const summaryRow = data.summary;
  const summary = {
    sends: toNumber(summaryRow["sends"]),
    delivered: toNumber(summaryRow["delivered"]),
    opens: toNumber(summaryRow["opens"]),
    clicks: toNumber(summaryRow["clicks"]),
    bounces: toNumber(summaryRow["bounces"]),
    unsubscribes: toNumber(summaryRow["unsubscribes"]),
    complaints: toNumber(summaryRow["complaints"]),
  };
  return {
    category: "emails" as const,
    range: publicRange(range),
    summary: {
      ...summary,
      deliveryRate: rate(summary.delivered, summary.sends),
      openRate: rate(summary.opens, summary.delivered),
      clickRate: rate(summary.clicks, summary.delivered),
      clickToOpenRate: rate(summary.clicks, summary.opens),
      bounceRate: rate(summary.bounces, summary.sends),
      unsubscribeRate: rate(summary.unsubscribes, summary.delivered),
    },
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      sends: toNumber(row["sends"]),
      delivered: toNumber(row["delivered"]),
      opens: toNumber(row["opens"]),
      clicks: toNumber(row["clicks"]),
    })),
    sources: data.sources.map((row) => {
      const sends = toNumber(row["sends"]);
      const delivered = toNumber(row["delivered"]);
      const opens = toNumber(row["opens"]);
      const clicks = toNumber(row["clicks"]);
      return {
        id: primitiveString(row["source_id"]),
        name: primitiveString(row["source_name"]),
        type: primitiveString(row["source_type"]),
        sends,
        delivered,
        opens,
        clicks,
        bounces: toNumber(row["bounces"]),
        unsubscribes: toNumber(row["unsubscribes"]),
        openRate: rate(opens, delivered),
        clickRate: rate(clicks, delivered),
      };
    }),
  };
}
