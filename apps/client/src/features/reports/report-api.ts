import { rpc } from "@/rpc";
import type { ReportCategory } from "@kaenma/shared/reports";

export type ReportView = "overview" | ReportCategory;

export interface ReportSearch {
  view: ReportView;
  from: string;
  to: string;
  currency: string;
}

export interface ReportRange {
  from: string;
  to: string;
}

export interface ContactsReport {
  category: "contacts";
  range: ReportRange;
  summary: {
    totalContacts: number;
    activeContacts: number;
    inactiveContacts: number;
    anonymousContacts: number;
    newContacts: number;
    archivedContacts: number;
  };
  trend: Array<{ day: string; added: number; archived: number }>;
  topTags: Array<{ id: string; name: string; color: string; contactCount: number }>;
  topLists: Array<{ id: string; name: string; color: string; contactCount: number }>;
}

export interface AutomationsReport {
  category: "automations";
  range: ReportRange;
  summary: {
    automationCount: number;
    entries: number;
    completions: number;
    activeContacts: number;
    sends: number;
    opens: number;
    clicks: number;
    completionRate: number;
    openRate: number;
    clickRate: number;
  };
  trend: Array<{ day: string; entries: number; completions: number }>;
  automations: Array<{
    id: string;
    name: string;
    status: string;
    entries: number;
    completions: number;
    activeContacts: number;
    sends: number;
    opens: number;
    clicks: number;
  }>;
}

export interface EmailsReport {
  category: "emails";
  range: ReportRange;
  summary: {
    sends: number;
    delivered: number;
    opens: number;
    clicks: number;
    bounces: number;
    unsubscribes: number;
    complaints: number;
    deliveryRate: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    bounceRate: number;
    unsubscribeRate: number;
  };
  trend: Array<{
    day: string;
    sends: number;
    delivered: number;
    opens: number;
    clicks: number;
  }>;
  sources: Array<{
    id: string;
    name: string;
    type: string;
    sends: number;
    delivered: number;
    opens: number;
    clicks: number;
    bounces: number;
    unsubscribes: number;
    openRate: number;
    clickRate: number;
  }>;
}

export interface DealsReport {
  category: "deals";
  range: ReportRange;
  currency: string;
  currencies: string[];
  summary: {
    created: number;
    won: number;
    lost: number;
    wonValue: number;
    openCount: number;
    openValue: number;
    winRate: number;
    openTasks: number;
    overdueTasks: number;
    completedTasks: number;
  };
  trend: Array<{ day: string; created: number; won: number; lost: number }>;
  owners: Array<{
    id: string;
    name: string;
    created: number;
    won: number;
    lost: number;
    wonValue: number;
    openCount: number;
  }>;
  forecast: Array<{
    stageId: string;
    stageName: string;
    color: string;
    probability: number;
    dealCount: number;
    dealValue: number;
    weightedValue: number;
  }>;
}

export interface SiteReport {
  category: "site";
  range: ReportRange;
  summary: {
    pageViews: number;
    uniqueVisitors: number;
    identifiedContacts: number;
    identificationRate: number;
    submissions: number;
    submittingContacts: number;
    messageImpressions: number;
    messageClicks: number;
  };
  trend: Array<{ day: string; pageViews: number; submissions: number }>;
  topPages: Array<{
    url: string;
    views: number;
    uniqueVisitors: number;
    identifiedContacts: number;
  }>;
  forms: Array<{
    id: string;
    name: string;
    status: string;
    submissions: number;
    contacts: number;
  }>;
  messages: Array<{
    id: string;
    name: string;
    status: string;
    impressions: number;
    clicks: number;
    clickRate: number;
  }>;
  notes: { messageMetrics: string };
}

export interface ReportWorkspace {
  view: ReportView;
  contacts?: ContactsReport;
  automations?: AutomationsReport;
  emails?: EmailsReport;
  deals?: DealsReport;
  site?: SiteReport;
}

const today = new Date();
const thirtyDaysAgo = new Date(today);
thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29);

export const reportSearchDefaults: ReportSearch = {
  view: "overview",
  from: isoDate(thirtyDaysAgo),
  to: isoDate(today),
  currency: "",
};

export async function loadReportWorkspace(
  search: ReportSearch,
  signal?: AbortSignal,
): Promise<ReportWorkspace> {
  if (search.view === "overview") {
    const [contacts, automations, emails, deals, site] = await Promise.all([
      loadReport<ContactsReport>("contacts", search, signal),
      loadReport<AutomationsReport>("automations", search, signal),
      loadReport<EmailsReport>("emails", search, signal),
      loadReport<DealsReport>("deals", search, signal),
      loadReport<SiteReport>("site", search, signal),
    ]);
    return { view: search.view, contacts, automations, emails, deals, site };
  }

  switch (search.view) {
    case "contacts":
      return {
        view: search.view,
        contacts: await loadReport<ContactsReport>("contacts", search, signal),
      };
    case "automations":
      return {
        view: search.view,
        automations: await loadReport<AutomationsReport>("automations", search, signal),
      };
    case "emails":
      return {
        view: search.view,
        emails: await loadReport<EmailsReport>("emails", search, signal),
      };
    case "deals":
      return {
        view: search.view,
        deals: await loadReport<DealsReport>("deals", search, signal),
      };
    case "site":
      return {
        view: search.view,
        site: await loadReport<SiteReport>("site", search, signal),
      };
  }
}

async function loadReport<T>(
  category: ReportCategory,
  search: ReportSearch,
  signal?: AbortSignal,
): Promise<T> {
  const params = new URLSearchParams({ from: search.from, to: search.to });
  if (category === "deals" && search.currency) params.set("currency", search.currency);
  const response = await rpc<T>(`/reports/${category}?${params.toString()}`, {
    signal: signal ?? null,
  });
  return response.data;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
