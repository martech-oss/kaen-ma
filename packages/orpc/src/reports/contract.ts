import { oc } from "@orpc/contract";
import * as z from "zod";

import { workspaceErrors } from "../shared/errors";
import {
  automationsReportSchema,
  contactsReportSchema,
  dealsReportSchema,
  emailsReportSchema,
  reportDateRangeSchema,
  siteReportSchema,
} from "./schema";

/** Reports are analyst-and-above; the range is validated by the shared schema. */
const analystErrors = {
  ...workspaceErrors,
  FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
} as const;

const rangeInput = reportDateRangeSchema;
const dealsInput = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});

export const reportsContract = {
  contacts: oc
    .route({ method: "GET", path: "/reports/contacts" })
    .errors(analystErrors)
    .input(rangeInput)
    .output(contactsReportSchema),
  automations: oc
    .route({ method: "GET", path: "/reports/automations" })
    .errors(analystErrors)
    .input(rangeInput)
    .output(automationsReportSchema),
  emails: oc
    .route({ method: "GET", path: "/reports/emails" })
    .errors(analystErrors)
    .input(rangeInput)
    .output(emailsReportSchema),
  deals: oc
    .route({ method: "GET", path: "/reports/deals" })
    .errors(analystErrors)
    .input(dealsInput)
    .output(dealsReportSchema),
  site: oc
    .route({ method: "GET", path: "/reports/site" })
    .errors(analystErrors)
    .input(rangeInput)
    .output(siteReportSchema),
};
