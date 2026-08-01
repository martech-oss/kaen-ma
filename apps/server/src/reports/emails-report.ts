import { primitiveString } from "../platform/values";
import {
  firstRow,
  publicRange,
  rate,
  type ReportDatabase,
  type ReportRange,
  rows,
  toNumber,
} from "./shared";

export async function emailReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const results = await database.batch([
    database
      .prepare(
        `SELECT
           COUNT(DISTINCT d.id) AS sends,
           COUNT(DISTINCT CASE
             WHEN d.status = 'delivered' OR de.type = 'delivered' THEN d.id
           END) AS delivered,
           COUNT(DISTINCT CASE WHEN de.type = 'opened' THEN d.id END) AS opens,
           COUNT(DISTINCT CASE WHEN de.type = 'clicked' THEN d.id END) AS clicks,
           COUNT(DISTINCT CASE WHEN de.type = 'bounced' THEN d.id END) AS bounces,
           COUNT(DISTINCT CASE WHEN de.type = 'unsubscribed' THEN d.id END) AS unsubscribes,
           COUNT(DISTINCT CASE WHEN de.type = 'complained' THEN d.id END) AS complaints
         FROM deliveries d
         LEFT JOIN delivery_events de
           ON de.workspace_id = d.workspace_id AND de.delivery_id = d.id
         WHERE d.workspace_id = ? AND d.channel = 'email'
           AND d.status IN ('accepted', 'delivered', 'failed')
           AND d.created_at >= ? AND d.created_at < ?`,
      )
      .bind(workspaceId, range.fromTimestamp, range.toExclusiveTimestamp),
    database
      .prepare(
        `SELECT
           date(d.created_at) AS day,
           COUNT(DISTINCT d.id) AS sends,
           COUNT(DISTINCT CASE
             WHEN d.status = 'delivered' OR de.type = 'delivered' THEN d.id
           END) AS delivered,
           COUNT(DISTINCT CASE WHEN de.type = 'opened' THEN d.id END) AS opens,
           COUNT(DISTINCT CASE WHEN de.type = 'clicked' THEN d.id END) AS clicks
         FROM deliveries d
         LEFT JOIN delivery_events de
           ON de.workspace_id = d.workspace_id AND de.delivery_id = d.id
         WHERE d.workspace_id = ? AND d.channel = 'email'
           AND d.status IN ('accepted', 'delivered', 'failed')
           AND d.created_at >= ? AND d.created_at < ?
         GROUP BY date(d.created_at)
         ORDER BY day`,
      )
      .bind(workspaceId, range.fromTimestamp, range.toExclusiveTimestamp),
    database
      .prepare(
        `SELECT
           COALESCE(b.id, c.id, et.id, 'other') AS source_id,
           COALESCE(b.name, c.name, et.name, 'その他のメール') AS source_name,
           CASE
             WHEN b.id IS NOT NULL THEN 'broadcast'
             WHEN c.id IS NOT NULL THEN 'automation'
             ELSE 'transactional'
           END AS source_type,
           COUNT(DISTINCT d.id) AS sends,
           COUNT(DISTINCT CASE
             WHEN d.status = 'delivered' OR de.type = 'delivered' THEN d.id
           END) AS delivered,
           COUNT(DISTINCT CASE WHEN de.type = 'opened' THEN d.id END) AS opens,
           COUNT(DISTINCT CASE WHEN de.type = 'clicked' THEN d.id END) AS clicks,
           COUNT(DISTINCT CASE WHEN de.type = 'bounced' THEN d.id END) AS bounces,
           COUNT(DISTINCT CASE WHEN de.type = 'unsubscribed' THEN d.id END) AS unsubscribes
         FROM deliveries d
         LEFT JOIN delivery_events de
           ON de.workspace_id = d.workspace_id AND de.delivery_id = d.id
         LEFT JOIN broadcasts b
           ON b.workspace_id = d.workspace_id AND b.id = d.broadcast_id
         LEFT JOIN campaign_enrollments ce
           ON ce.workspace_id = d.workspace_id AND ce.id = d.enrollment_id
         LEFT JOIN campaigns c
           ON c.workspace_id = ce.workspace_id AND c.id = ce.campaign_id
         LEFT JOIN email_templates et
           ON et.workspace_id = d.workspace_id AND et.id = d.template_id
         WHERE d.workspace_id = ? AND d.channel = 'email'
           AND d.status IN ('accepted', 'delivered', 'failed')
           AND d.created_at >= ? AND d.created_at < ?
         GROUP BY source_id, source_name, source_type
         ORDER BY sends DESC, source_name ASC
         LIMIT 100`,
      )
      .bind(workspaceId, range.fromTimestamp, range.toExclusiveTimestamp),
  ] as const);
  const summaryRow = firstRow(results[0]);
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
    trend: rows(results[1]).map((row) => ({
      day: primitiveString(row["day"]),
      sends: toNumber(row["sends"]),
      delivered: toNumber(row["delivered"]),
      opens: toNumber(row["opens"]),
      clicks: toNumber(row["clicks"]),
    })),
    sources: rows(results[2]).map((row) => {
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
