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

export async function siteReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const results = await database.batch([
    database
      .prepare(
        `SELECT
           COUNT(*) AS page_views,
           COUNT(DISTINCT COALESCE(visitor_id, contact_id)) AS unique_visitors,
           COUNT(DISTINCT contact_id) AS identified_contacts
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
           AND occurred_at >= ? AND occurred_at < ?`,
      )
      .bind(workspaceId, range.fromTimestamp, range.toExclusiveTimestamp),
    database
      .prepare(
        `SELECT COUNT(*) AS submissions,
                COUNT(DISTINCT contact_id) AS submitting_contacts
         FROM form_submissions
         WHERE workspace_id = ? AND created_at >= ? AND created_at < ?`,
      )
      .bind(workspaceId, range.fromTimestamp, range.toExclusiveTimestamp),
    database
      .prepare(
        `WITH activity AS (
           SELECT date(occurred_at) AS day, 1 AS page_views, 0 AS submissions
           FROM contact_events
           WHERE workspace_id = ? AND type = 'page_viewed'
             AND occurred_at >= ? AND occurred_at < ?
           UNION ALL
           SELECT date(created_at) AS day, 0 AS page_views, 1 AS submissions
           FROM form_submissions
           WHERE workspace_id = ? AND created_at >= ? AND created_at < ?
         )
         SELECT day, SUM(page_views) AS page_views, SUM(submissions) AS submissions
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
    database
      .prepare(
        `SELECT
           resource_id AS url,
           COUNT(*) AS views,
           COUNT(DISTINCT COALESCE(visitor_id, contact_id)) AS unique_visitors,
           COUNT(DISTINCT contact_id) AS identified_contacts
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
           AND occurred_at >= ? AND occurred_at < ?
           AND resource_id IS NOT NULL
         GROUP BY resource_id
         ORDER BY views DESC
         LIMIT 20`,
      )
      .bind(workspaceId, range.fromTimestamp, range.toExclusiveTimestamp),
    database
      .prepare(
        `SELECT
           f.id,
           f.name,
           f.status,
           COUNT(fs.id) AS submissions,
           COUNT(DISTINCT fs.contact_id) AS contacts
         FROM forms f
         LEFT JOIN form_submissions fs
           ON fs.workspace_id = f.workspace_id AND fs.form_id = f.id
              AND fs.created_at >= ? AND fs.created_at < ?
         WHERE f.workspace_id = ? AND f.status != 'archived'
         GROUP BY f.id
         ORDER BY submissions DESC, f.name ASC`,
      )
      .bind(range.fromTimestamp, range.toExclusiveTimestamp, workspaceId),
    database
      .prepare(
        `SELECT id, name, status, impression_count, click_count
         FROM site_messages
         WHERE workspace_id = ? AND status != 'archived'
         ORDER BY impression_count DESC, name ASC`,
      )
      .bind(workspaceId),
  ] as const);
  const pageSummary = firstRow(results[0]);
  const formSummary = firstRow(results[1]);
  const pageViews = toNumber(pageSummary["page_views"]);
  const uniqueVisitors = toNumber(pageSummary["unique_visitors"]);
  const identifiedContacts = toNumber(pageSummary["identified_contacts"]);
  const messages = rows(results[5]).map((row) => {
    const impressions = toNumber(row["impression_count"]);
    const clicks = toNumber(row["click_count"]);
    return {
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      status: primitiveString(row["status"]),
      impressions,
      clicks,
      clickRate: rate(clicks, impressions),
    };
  });
  return {
    category: "site" as const,
    range: publicRange(range),
    summary: {
      pageViews,
      uniqueVisitors,
      identifiedContacts,
      identificationRate: rate(identifiedContacts, uniqueVisitors),
      submissions: toNumber(formSummary["submissions"]),
      submittingContacts: toNumber(formSummary["submitting_contacts"]),
      messageImpressions: messages.reduce((sum, message) => sum + message.impressions, 0),
      messageClicks: messages.reduce((sum, message) => sum + message.clicks, 0),
    },
    trend: rows(results[2]).map((row) => ({
      day: primitiveString(row["day"]),
      pageViews: toNumber(row["page_views"]),
      submissions: toNumber(row["submissions"]),
    })),
    topPages: rows(results[3]).map((row) => ({
      url: primitiveString(row["url"]),
      views: toNumber(row["views"]),
      uniqueVisitors: toNumber(row["unique_visitors"]),
      identifiedContacts: toNumber(row["identified_contacts"]),
    })),
    forms: rows(results[4]).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      status: primitiveString(row["status"]),
      submissions: toNumber(row["submissions"]),
      contacts: toNumber(row["contacts"]),
    })),
    messages,
    notes: {
      messageMetrics: "サイトメッセージの表示・クリックは累計値です",
    },
  };
}
