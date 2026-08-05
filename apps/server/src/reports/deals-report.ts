import { ReportsRepository } from "@openengage/database";

import { primitiveString } from "../platform/values";
import { publicRange, rate, type ReportDatabase, type ReportRange, toNumber } from "./shared";

export async function dealReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
  requestedCurrency?: string,
) {
  const repository = new ReportsRepository(database);
  const currencies = (await repository.listDealCurrencies(workspaceId)).map((row) => row.currency);
  const currency =
    (requestedCurrency && currencies.includes(requestedCurrency) ? requestedCurrency : undefined) ??
    currencies[0] ??
    "JPY";
  const data = await repository.dealsSummary(workspaceId, range, currency);
  const summary = data.summary;
  const taskSummary = data.taskSummary;
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
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      created: toNumber(row["created"]),
      won: toNumber(row["won"]),
      lost: toNumber(row["lost"]),
    })),
    owners: data.owners.map((row) => ({
      id: primitiveString(row["owner_id"]),
      name: primitiveString(row["owner_name"]),
      created: toNumber(row["created"]),
      won: toNumber(row["won"]),
      lost: toNumber(row["lost"]),
      wonValue: toNumber(row["won_value"]),
      openCount: toNumber(row["open_count"]),
    })),
    forecast: data.forecast.map((row) => ({
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
