import type {
  AutomationsReport,
  ContactsReport,
  DealsReport,
  EmailsReport,
  ReportCategory,
  SiteReport,
} from "@openengage/orpc";

import { orpc } from "@/lib/orpc";

export type { AutomationsReport, ContactsReport, DealsReport, EmailsReport, SiteReport };

export interface ReportRange {
  from: string;
  to: string;
}

export type ReportView = "overview" | ReportCategory;

export interface ReportSearch {
  view: ReportView;
  from: string;
  to: string;
  currency: string;
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
  const range = { from: search.from, to: search.to };
  const options = signal ? { signal } : undefined;
  const dealsInput = { ...range, ...(search.currency ? { currency: search.currency } : {}) };

  if (search.view === "overview") {
    const [contacts, automations, emails, deals, site] = await Promise.all([
      orpc.reports.contacts(range, options),
      orpc.reports.automations(range, options),
      orpc.reports.emails(range, options),
      orpc.reports.deals(dealsInput, options),
      orpc.reports.site(range, options),
    ]);
    return { view: search.view, contacts, automations, emails, deals, site };
  }

  switch (search.view) {
    case "contacts":
      return { view: search.view, contacts: await orpc.reports.contacts(range, options) };
    case "automations":
      return { view: search.view, automations: await orpc.reports.automations(range, options) };
    case "emails":
      return { view: search.view, emails: await orpc.reports.emails(range, options) };
    case "deals":
      return { view: search.view, deals: await orpc.reports.deals(dealsInput, options) };
    case "site":
      return { view: search.view, site: await orpc.reports.site(range, options) };
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
