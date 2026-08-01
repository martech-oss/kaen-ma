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

export async function dealReport(
  database: ReportDatabase,
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
  const created = toNumber(summary["created"]);
  const won = toNumber(summary["won"]);
  return {
    category: "deals" as const,
    range: publicRange(range),
    currency,
    currencies: currencies.length > 0 ? currencies : [currency],
    summary: {
      created,
      won,
      lost: toNumber(summary["lost"]),
      wonValue: toNumber(summary["won_value"]),
      openCount: toNumber(summary["open_count"]),
      openValue: toNumber(summary["open_value"]),
      winRate: rate(won, won + toNumber(summary["lost"])),
      openTasks: toNumber(taskSummary["open_tasks"]),
      overdueTasks: toNumber(taskSummary["overdue_tasks"]),
      completedTasks: toNumber(taskSummary["completed_tasks"]),
    },
    trend: rows(results[1]).map((row) => ({
      day: primitiveString(row["day"]),
      created: toNumber(row["created"]),
      won: toNumber(row["won"]),
      lost: toNumber(row["lost"]),
    })),
    owners: rows(results[2]).map((row) => ({
      id: primitiveString(row["owner_id"]),
      name: primitiveString(row["owner_name"]),
      created: toNumber(row["created"]),
      won: toNumber(row["won"]),
      lost: toNumber(row["lost"]),
      wonValue: toNumber(row["won_value"]),
      openCount: toNumber(row["open_count"]),
    })),
    forecast: rows(results[3]).map((row) => ({
      stageId: primitiveString(row["stage_id"]),
      stageName: primitiveString(row["stage_name"]),
      color: primitiveString(row["color"]),
      probability: toNumber(row["probability"]),
      dealCount: toNumber(row["deal_count"]),
      dealValue: toNumber(row["deal_value"]),
      weightedValue: toNumber(row["weighted_value"]),
    })),
  };
}
