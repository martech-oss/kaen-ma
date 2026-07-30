import type { Hono } from "hono";

import { reportCategorySchema, reportQuerySchema } from "@kaenma/shared/reports";

import type { AppEnvironment } from "../env";
import { validationError } from "../http/helpers";
import { requireRole } from "../middleware";
import { automationReport } from "./automations-report";
import { contactReport } from "./contacts-report";
import { dealReport } from "./deals-report";
import { emailReport } from "./emails-report";
import { defaultRange, toReportRange } from "./shared";
import { siteReport } from "./site-report";

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
