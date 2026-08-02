import { ReportsRepository } from "@kaenma/database";

import { primitiveString } from "../platform/values";
import { publicRange, rate, type ReportDatabase, type ReportRange, toNumber } from "./shared";

export async function siteReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const data = await new ReportsRepository(database).siteSummary(workspaceId, range);
  const pageSummary = data.pageSummary;
  const formSummary = data.formSummary;
  const pageViews = toNumber(pageSummary["page_views"]);
  const uniqueVisitors = toNumber(pageSummary["unique_visitors"]);
  const identifiedContacts = toNumber(pageSummary["identified_contacts"]);
  const messages = data.messages.map((row) => {
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
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      pageViews: toNumber(row["page_views"]),
      submissions: toNumber(row["submissions"]),
    })),
    topPages: data.topPages.map((row) => ({
      url: primitiveString(row["url"]),
      views: toNumber(row["views"]),
      uniqueVisitors: toNumber(row["unique_visitors"]),
      identifiedContacts: toNumber(row["identified_contacts"]),
    })),
    forms: data.forms.map((row) => ({
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
