import type { Hono } from "hono";

import { reportCategorySchema, reportQuerySchema } from "@kaenma/shared/reports";

import type { AppEnvironment } from "../env";
import { validationError } from "../http/helpers";
import { requireRole } from "../middleware";

interface ReportRange {
  from: string;
  to: string;
  fromTimestamp: string;
  toExclusiveTimestamp: string;
}

export function registerReportRoutes(api: Hono<AppEnvironment>): void {
  api.get("/reports/:category", requireRole("analyst"), async (context) => {
    const category = reportCategorySchema.safeParse(context.req.param("category"));
    if (!category.success) return validationError(context, category.error);
    const defaults = defaultRange();
    const query = reportQuerySchema.safeParse({
      from: context.req.query("from") ?? defaults.from,
      to: context.req.query("to") ?? defaults.to,
      currency: context.req.query("currency"),
    });
    if (!query.success) return validationError(context, query.error);
    const range = toReportRange(query.data.from, query.data.to);
    const database = context.get("database");
    const workspaceId = context.get("workspace").workspaceId;

    switch (category.data) {
      case "contacts":
        return context.json({ data: await contactReport(database, workspaceId, range) });
      case "automations":
        return context.json({ data: await automationReport(database, workspaceId, range) });
      case "emails":
        return context.json({ data: await emailReport(database, workspaceId, range) });
      case "deals":
        return context.json({
          data: await dealReport(database, workspaceId, range, query.data.currency),
        });
      case "site":
        return context.json({ data: await siteReport(database, workspaceId, range) });
    }
  });
}

async function contactReport(
  database: AppEnvironment["Variables"]["database"],
  workspaceId: string,
  range: ReportRange,
) {
  const results = await database.batch([
    database
      .prepare(
        `SELECT
           COUNT(*) AS total_contacts,
           COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_contacts,
           COUNT(CASE WHEN status != 'active' THEN 1 END) AS inactive_contacts,
           COUNT(CASE WHEN status = 'anonymous' THEN 1 END) AS anonymous_contacts,
           COUNT(CASE WHEN created_at >= ? AND created_at < ? THEN 1 END) AS new_contacts,
           COUNT(CASE WHEN archived_at >= ? AND archived_at < ? THEN 1 END) AS archived_contacts
         FROM contacts
         WHERE workspace_id = ?`,
      )
      .bind(
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        workspaceId,
      ),
    database
      .prepare(
        `WITH contact_changes AS (
           SELECT date(created_at) AS day, 1 AS added, 0 AS archived
           FROM contacts
           WHERE workspace_id = ? AND created_at >= ? AND created_at < ?
           UNION ALL
           SELECT date(archived_at) AS day, 0 AS added, 1 AS archived
           FROM contacts
           WHERE workspace_id = ? AND archived_at >= ? AND archived_at < ?
         )
         SELECT day, SUM(added) AS added, SUM(archived) AS archived
         FROM contact_changes
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
        `SELECT t.id, t.name, t.color,
                COUNT(c.id) AS contact_count
         FROM tags t
         LEFT JOIN contact_tags ct
           ON ct.workspace_id = t.workspace_id AND ct.tag_id = t.id
         LEFT JOIN contacts c
           ON c.workspace_id = ct.workspace_id AND c.id = ct.contact_id
              AND c.status = 'active'
         WHERE t.workspace_id = ?
         GROUP BY t.id
         ORDER BY contact_count DESC, t.name ASC
         LIMIT 10`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT cl.id, cl.name, cl.color,
                COUNT(CASE WHEN clm.status = 'active' AND c.status = 'active' THEN 1 END)
                  AS contact_count
         FROM contact_lists cl
         LEFT JOIN contact_list_memberships clm
           ON clm.workspace_id = cl.workspace_id AND clm.list_id = cl.id
         LEFT JOIN contacts c
           ON c.workspace_id = clm.workspace_id AND c.id = clm.contact_id
         WHERE cl.workspace_id = ?
         GROUP BY cl.id
         ORDER BY contact_count DESC, cl.name ASC
         LIMIT 10`,
      )
      .bind(workspaceId),
  ] as const);
  const summary = firstRow(results[0]);
  return {
    category: "contacts" as const,
    range: publicRange(range),
    summary: {
      totalContacts: number(summary["total_contacts"]),
      activeContacts: number(summary["active_contacts"]),
      inactiveContacts: number(summary["inactive_contacts"]),
      anonymousContacts: number(summary["anonymous_contacts"]),
      newContacts: number(summary["new_contacts"]),
      archivedContacts: number(summary["archived_contacts"]),
    },
    trend: rows(results[1]).map((row) => ({
      day: string(row["day"]),
      added: number(row["added"]),
      archived: number(row["archived"]),
    })),
    topTags: rows(results[2]).map((row) => ({
      id: string(row["id"]),
      name: string(row["name"]),
      color: string(row["color"]),
      contactCount: number(row["contact_count"]),
    })),
    topLists: rows(results[3]).map((row) => ({
      id: string(row["id"]),
      name: string(row["name"]),
      color: string(row["color"]),
      contactCount: number(row["contact_count"]),
    })),
  };
}

async function automationReport(
  database: AppEnvironment["Variables"]["database"],
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
    id: string(row["id"]),
    name: string(row["name"]),
    status: string(row["status"]),
    entries: number(row["entries"]),
    completions: number(row["completions"]),
    activeContacts: number(row["active_contacts"]),
    sends: number(row["sends"]),
    opens: number(row["opens"]),
    clicks: number(row["clicks"]),
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
      day: string(row["day"]),
      entries: number(row["entries"]),
      completions: number(row["completions"]),
    })),
    automations,
  };
}

async function emailReport(
  database: AppEnvironment["Variables"]["database"],
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
    sends: number(summaryRow["sends"]),
    delivered: number(summaryRow["delivered"]),
    opens: number(summaryRow["opens"]),
    clicks: number(summaryRow["clicks"]),
    bounces: number(summaryRow["bounces"]),
    unsubscribes: number(summaryRow["unsubscribes"]),
    complaints: number(summaryRow["complaints"]),
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
      day: string(row["day"]),
      sends: number(row["sends"]),
      delivered: number(row["delivered"]),
      opens: number(row["opens"]),
      clicks: number(row["clicks"]),
    })),
    sources: rows(results[2]).map((row) => {
      const sends = number(row["sends"]);
      const delivered = number(row["delivered"]);
      const opens = number(row["opens"]);
      const clicks = number(row["clicks"]);
      return {
        id: string(row["source_id"]),
        name: string(row["source_name"]),
        type: string(row["source_type"]),
        sends,
        delivered,
        opens,
        clicks,
        bounces: number(row["bounces"]),
        unsubscribes: number(row["unsubscribes"]),
        openRate: rate(opens, delivered),
        clickRate: rate(clicks, delivered),
      };
    }),
  };
}

async function dealReport(
  database: AppEnvironment["Variables"]["database"],
  workspaceId: string,
  range: ReportRange,
  requestedCurrency?: string,
) {
  const currencyResult = await database
    .prepare(
      `SELECT DISTINCT currency
       FROM deals
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY currency`,
    )
    .bind(workspaceId)
    .all<{ currency: string }>();
  const currencies = currencyResult.results.map((row) => row.currency);
  const currency =
    (requestedCurrency && currencies.includes(requestedCurrency) ? requestedCurrency : undefined) ??
    currencies[0] ??
    "JPY";
  const results = await database.batch([
    database
      .prepare(
        `SELECT
           COUNT(CASE WHEN created_at >= ? AND created_at < ? THEN 1 END) AS created,
           COUNT(CASE WHEN won_at >= ? AND won_at < ? THEN 1 END) AS won,
           COUNT(CASE WHEN lost_at >= ? AND lost_at < ? THEN 1 END) AS lost,
           COALESCE(SUM(CASE WHEN won_at >= ? AND won_at < ? THEN value ELSE 0 END), 0)
             AS won_value,
           COUNT(CASE WHEN status = 'open' THEN 1 END) AS open_count,
           COALESCE(SUM(CASE WHEN status = 'open' THEN value ELSE 0 END), 0) AS open_value
         FROM deals
         WHERE workspace_id = ? AND archived_at IS NULL AND currency = ?`,
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
        workspaceId,
        currency,
      ),
    database
      .prepare(
        `WITH activity AS (
           SELECT date(created_at) AS day, 1 AS created, 0 AS won, 0 AS lost
           FROM deals
           WHERE workspace_id = ? AND archived_at IS NULL AND currency = ?
             AND created_at >= ? AND created_at < ?
           UNION ALL
           SELECT date(won_at) AS day, 0 AS created, 1 AS won, 0 AS lost
           FROM deals
           WHERE workspace_id = ? AND archived_at IS NULL AND currency = ?
             AND won_at >= ? AND won_at < ?
           UNION ALL
           SELECT date(lost_at) AS day, 0 AS created, 0 AS won, 1 AS lost
           FROM deals
           WHERE workspace_id = ? AND archived_at IS NULL AND currency = ?
             AND lost_at >= ? AND lost_at < ?
         )
         SELECT day, SUM(created) AS created, SUM(won) AS won, SUM(lost) AS lost
         FROM activity
         GROUP BY day
         ORDER BY day`,
      )
      .bind(
        workspaceId,
        currency,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        workspaceId,
        currency,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        workspaceId,
        currency,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
      ),
    database
      .prepare(
        `SELECT
           COALESCE(u.id, 'unassigned') AS owner_id,
           COALESCE(u.name, '未設定') AS owner_name,
           COUNT(CASE WHEN d.created_at >= ? AND d.created_at < ? THEN 1 END) AS created,
           COUNT(CASE WHEN d.won_at >= ? AND d.won_at < ? THEN 1 END) AS won,
           COUNT(CASE WHEN d.lost_at >= ? AND d.lost_at < ? THEN 1 END) AS lost,
           COALESCE(SUM(CASE
             WHEN d.won_at >= ? AND d.won_at < ? THEN d.value ELSE 0
           END), 0) AS won_value,
           COUNT(CASE WHEN d.status = 'open' THEN 1 END) AS open_count
         FROM deals d
         LEFT JOIN user u ON u.id = d.owner_user_id
         WHERE d.workspace_id = ? AND d.archived_at IS NULL AND d.currency = ?
         GROUP BY owner_id, owner_name
         ORDER BY won_value DESC, won DESC, owner_name ASC`,
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
        workspaceId,
        currency,
      ),
    database
      .prepare(
        `SELECT
           ds.id AS stage_id,
           ds.name AS stage_name,
           ds.color,
           ds.probability,
           COUNT(d.id) AS deal_count,
           COALESCE(SUM(d.value), 0) AS deal_value,
           COALESCE(SUM(d.value * ds.probability / 100.0), 0) AS weighted_value
         FROM deal_stages ds
         JOIN deals d
           ON d.workspace_id = ds.workspace_id AND d.stage_id = ds.id
         WHERE d.workspace_id = ? AND d.archived_at IS NULL
           AND d.status = 'open' AND d.currency = ?
           AND d.expected_close_date >= ? AND d.expected_close_date <= ?
         GROUP BY ds.id
         ORDER BY ds.position`,
      )
      .bind(workspaceId, currency, range.from, range.to),
    database
      .prepare(
        `SELECT
           COUNT(CASE WHEN status = 'open' THEN 1 END) AS open_tasks,
           COUNT(CASE WHEN status = 'open' AND due_at < ? THEN 1 END) AS overdue_tasks,
           COUNT(CASE WHEN completed_at >= ? AND completed_at < ? THEN 1 END)
             AS completed_tasks
         FROM deal_tasks
         WHERE workspace_id = ?`,
      )
      .bind(new Date().toISOString(), range.fromTimestamp, range.toExclusiveTimestamp, workspaceId),
  ] as const);
  const summary = firstRow(results[0]);
  const taskSummary = firstRow(results[4]);
  const created = number(summary["created"]);
  const won = number(summary["won"]);
  return {
    category: "deals" as const,
    range: publicRange(range),
    currency,
    currencies: currencies.length > 0 ? currencies : [currency],
    summary: {
      created,
      won,
      lost: number(summary["lost"]),
      wonValue: number(summary["won_value"]),
      openCount: number(summary["open_count"]),
      openValue: number(summary["open_value"]),
      winRate: rate(won, won + number(summary["lost"])),
      openTasks: number(taskSummary["open_tasks"]),
      overdueTasks: number(taskSummary["overdue_tasks"]),
      completedTasks: number(taskSummary["completed_tasks"]),
    },
    trend: rows(results[1]).map((row) => ({
      day: string(row["day"]),
      created: number(row["created"]),
      won: number(row["won"]),
      lost: number(row["lost"]),
    })),
    owners: rows(results[2]).map((row) => ({
      id: string(row["owner_id"]),
      name: string(row["owner_name"]),
      created: number(row["created"]),
      won: number(row["won"]),
      lost: number(row["lost"]),
      wonValue: number(row["won_value"]),
      openCount: number(row["open_count"]),
    })),
    forecast: rows(results[3]).map((row) => ({
      stageId: string(row["stage_id"]),
      stageName: string(row["stage_name"]),
      color: string(row["color"]),
      probability: number(row["probability"]),
      dealCount: number(row["deal_count"]),
      dealValue: number(row["deal_value"]),
      weightedValue: number(row["weighted_value"]),
    })),
  };
}

async function siteReport(
  database: AppEnvironment["Variables"]["database"],
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
  const pageViews = number(pageSummary["page_views"]);
  const uniqueVisitors = number(pageSummary["unique_visitors"]);
  const identifiedContacts = number(pageSummary["identified_contacts"]);
  const messages = rows(results[5]).map((row) => {
    const impressions = number(row["impression_count"]);
    const clicks = number(row["click_count"]);
    return {
      id: string(row["id"]),
      name: string(row["name"]),
      status: string(row["status"]),
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
      submissions: number(formSummary["submissions"]),
      submittingContacts: number(formSummary["submitting_contacts"]),
      messageImpressions: messages.reduce((sum, message) => sum + message.impressions, 0),
      messageClicks: messages.reduce((sum, message) => sum + message.clicks, 0),
    },
    trend: rows(results[2]).map((row) => ({
      day: string(row["day"]),
      pageViews: number(row["page_views"]),
      submissions: number(row["submissions"]),
    })),
    topPages: rows(results[3]).map((row) => ({
      url: string(row["url"]),
      views: number(row["views"]),
      uniqueVisitors: number(row["unique_visitors"]),
      identifiedContacts: number(row["identified_contacts"]),
    })),
    forms: rows(results[4]).map((row) => ({
      id: string(row["id"]),
      name: string(row["name"]),
      status: string(row["status"]),
      submissions: number(row["submissions"]),
      contacts: number(row["contacts"]),
    })),
    messages,
    notes: {
      messageMetrics: "サイトメッセージの表示・クリックは累計値です",
    },
  };
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

function toReportRange(from: string, to: string): ReportRange {
  const toExclusive = new Date(`${to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return {
    from,
    to,
    fromTimestamp: `${from}T00:00:00.000Z`,
    toExclusiveTimestamp: toExclusive.toISOString(),
  };
}

function publicRange(range: ReportRange) {
  return { from: range.from, to: range.to };
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function rows(result: D1Result | undefined): Record<string, unknown>[] {
  return (result?.results ?? []) as Record<string, unknown>[];
}

function firstRow(result: D1Result | undefined): Record<string, unknown> {
  return rows(result)[0] ?? {};
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function string(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}
