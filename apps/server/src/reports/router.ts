import { hasWorkspaceRole } from "../auth/authorization";
import { authed } from "../orpc/base";
import { automationReport } from "./automations-report";
import { contactReport } from "./contacts-report";
import { getDashboard } from "./dashboard-service";
import { dealReport } from "./deals-report";
import { emailReport } from "./emails-report";
import { toReportRange } from "./shared";
import { siteReport } from "./site-report";

function guard(role: string, forbidden: () => Error): void {
  if (!hasWorkspaceRole(role as never, "analyst")) throw forbidden();
}

export const contactsReportProcedure = authed.reports.contacts.handler(
  ({ context, input, errors }) => {
    guard(context.workspace.role, errors.FORBIDDEN);
    return contactReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to),
    );
  },
);

export const automationsReportProcedure = authed.reports.automations.handler(
  ({ context, input, errors }) => {
    guard(context.workspace.role, errors.FORBIDDEN);
    return automationReport(
      context.database,
      context.workspace.workspaceId,
      toReportRange(input.from, input.to),
    );
  },
);

export const emailsReportProcedure = authed.reports.emails.handler(({ context, input, errors }) => {
  guard(context.workspace.role, errors.FORBIDDEN);
  return emailReport(
    context.database,
    context.workspace.workspaceId,
    toReportRange(input.from, input.to),
  );
});

export const dealsReportProcedure = authed.reports.deals.handler(({ context, input, errors }) => {
  guard(context.workspace.role, errors.FORBIDDEN);
  return dealReport(
    context.database,
    context.workspace.workspaceId,
    toReportRange(input.from, input.to),
    input.currency,
  );
});

export const siteReportProcedure = authed.reports.site.handler(({ context, input, errors }) => {
  guard(context.workspace.role, errors.FORBIDDEN);
  return siteReport(
    context.database,
    context.workspace.workspaceId,
    toReportRange(input.from, input.to),
  );
});

export const dashboardProcedure = authed.operations.dashboard.handler(async ({ context }) => {
  return getDashboard(context.database, context.workspace.workspaceId);
});
