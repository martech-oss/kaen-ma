import { ReportsRepository } from "@kaenma/database";

import { primitiveString } from "../platform/values";
import { publicRange, type ReportDatabase, type ReportRange, toNumber } from "./shared";

export async function contactReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const data = await new ReportsRepository(database).contactsSummary(workspaceId, range);
  const summary = data.summary;
  return {
    category: "contacts" as const,
    range: publicRange(range),
    summary: {
      totalContacts: toNumber(summary["total_contacts"]),
      activeContacts: toNumber(summary["active_contacts"]),
      inactiveContacts: toNumber(summary["inactive_contacts"]),
      anonymousContacts: toNumber(summary["anonymous_contacts"]),
      newContacts: toNumber(summary["new_contacts"]),
      archivedContacts: toNumber(summary["archived_contacts"]),
    },
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      added: toNumber(row["added"]),
      archived: toNumber(row["archived"]),
    })),
    topTags: data.topTags.map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      color: primitiveString(row["color"]),
      contactCount: toNumber(row["contact_count"]),
    })),
    topLists: data.topLists.map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      color: primitiveString(row["color"]),
      contactCount: toNumber(row["contact_count"]),
    })),
  };
}
