import { primitiveString } from "../values";
import { publicRange, rate, type ReportDatabase, type ReportRange, rows, toNumber } from "./shared";

export async function automationReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const results = await database.batch([
    database
      .prepare(
        `SELECT
           c.id,
           c.name,
           c.status,
           COUNT(DISTINCT CASE
             WHEN ce.entered_at >= ? AND ce.entered_at < ? THEN ce.id
           END) AS entries,
           COUNT(DISTINCT CASE
             WHEN ce.completed_at >= ? AND ce.completed_at < ? THEN ce.id
           END) AS completions,
           COUNT(DISTINCT CASE
             WHEN ce.status = 'active' THEN ce.id
           END) AS active_contacts,
           COUNT(DISTINCT CASE
             WHEN d.created_at >= ? AND d.created_at < ? AND d.channel = 'email'
               AND d.status IN ('accepted', 'delivered', 'failed') THEN d.id
           END) AS sends,
           COUNT(DISTINCT CASE
             WHEN d.created_at >= ? AND d.created_at < ?
               AND d.channel = 'email'
               AND d.status IN ('accepted', 'delivered', 'failed')
               AND de.type = 'opened' THEN d.id
           END) AS opens,
           COUNT(DISTINCT CASE
             WHEN d.created_at >= ? AND d.created_at < ?
               AND d.channel = 'email'
               AND d.status IN ('accepted', 'delivered', 'failed')
               AND de.type = 'clicked' THEN d.id
           END) AS clicks
         FROM campaigns c
         LEFT JOIN campaign_enrollments ce
           ON ce.workspace_id = c.workspace_id AND ce.campaign_id = c.id
         LEFT JOIN deliveries d
           ON d.workspace_id = ce.workspace_id AND d.enrollment_id = ce.id
         LEFT JOIN delivery_events de
           ON de.workspace_id = d.workspace_id AND de.delivery_id = d.id
         WHERE c.workspace_id = ? AND c.status != 'archived'
         GROUP BY c.id
         ORDER BY entries DESC, c.updated_at DESC`,
      )
      .bind(
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        workspaceId,
      ),
    database
      .prepare(
        `WITH activity AS (
           SELECT date(entered_at) AS day, 1 AS entries, 0 AS completions
           FROM campaign_enrollments
           WHERE workspace_id = ? AND entered_at >= ? AND entered_at < ?
           UNION ALL
           SELECT date(completed_at) AS day, 0 AS entries, 1 AS completions
           FROM campaign_enrollments
           WHERE workspace_id = ? AND completed_at >= ? AND completed_at < ?
         )
         SELECT day, SUM(entries) AS entries, SUM(completions) AS completions
         FROM activity
         GROUP BY day
         ORDER BY day`,
      )
      .bind(
        workspaceId,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        workspaceId,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
      ),
  ] as const);
  const automations = rows(results[0]).map((row) => ({
    id: primitiveString(row["id"]),
    name: primitiveString(row["name"]),
    status: primitiveString(row["status"]),
    entries: toNumber(row["entries"]),
    completions: toNumber(row["completions"]),
    activeContacts: toNumber(row["active_contacts"]),
    sends: toNumber(row["sends"]),
    opens: toNumber(row["opens"]),
    clicks: toNumber(row["clicks"]),
  }));
  const totals = automations.reduce(
    (total, automation) => ({
      entries: total.entries + automation.entries,
      completions: total.completions + automation.completions,
      activeContacts: total.activeContacts + automation.activeContacts,
      sends: total.sends + automation.sends,
      opens: total.opens + automation.opens,
      clicks: total.clicks + automation.clicks,
    }),
    { entries: 0, completions: 0, activeContacts: 0, sends: 0, opens: 0, clicks: 0 },
  );
  return {
    category: "automations" as const,
    range: publicRange(range),
    summary: {
      automationCount: automations.length,
      ...totals,
      completionRate: rate(totals.completions, totals.entries),
      openRate: rate(totals.opens, totals.sends),
      clickRate: rate(totals.clicks, totals.sends),
    },
    trend: rows(results[1]).map((row) => ({
      day: primitiveString(row["day"]),
      entries: toNumber(row["entries"]),
      completions: toNumber(row["completions"]),
    })),
    automations,
  };
}
