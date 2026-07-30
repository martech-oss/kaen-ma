import { oc } from "@orpc/contract";
import * as z from "zod";

import { workspaceRoleSchema } from "@kaenma/shared";

import { workspaceErrors } from "../shared/errors";

export const dashboardSchema = z.object({
  contacts: z.object({ count: z.number().int().nonnegative() }),
  campaigns: z.object({ count: z.number().int().nonnegative() }),
  deliveries: z.object({
    sent: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  recentEvents: z.array(
    z.object({
      type: z.string(),
      occurredAt: z.string(),
      contactId: z.string().nullable(),
      properties: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const operationsContract = {
  dashboard: oc
    .route({ method: "GET", path: "/dashboard" })
    .errors(workspaceErrors)
    .output(dashboardSchema),
  createApiKey: oc
    .route({ method: "POST", path: "/api-keys", successStatus: 201 })
    .errors({
      ...workspaceErrors,
      FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
    })
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        role: workspaceRoleSchema.default("viewer"),
        expiresAt: z.iso.datetime().optional(),
      }),
    )
    // The token is shown once and never stored in plaintext.
    .output(z.object({ id: z.string(), token: z.string() })),
};
