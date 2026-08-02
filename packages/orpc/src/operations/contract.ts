import { oc } from "@orpc/contract";
import * as z from "zod";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { workspaceRoleSchema } from "../shared/schema";

export const CSV_MAX_BYTES = 25 * 1024 * 1024;

export const dataJobSchema = z.object({
  id: z.string(),
  kind: z.enum(["contact_import", "contact_export", "event_archive"]),
  status: z.string(),
  processed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errorManifestKey: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DataJob = z.infer<typeof dataJobSchema>;

export const deadLetterRowSchema = z.object({
  id: z.string(),
  sourceQueue: z.string(),
  error: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  status: z.enum(["pending", "replayed", "discarded"]),
  createdAt: z.string(),
  replayedAt: z.string().nullable(),
});
export type DeadLetterRow = z.infer<typeof deadLetterRowSchema>;

export const dashboardSchema = z.object({
  contacts: z.object({ count: z.number().int().nonnegative() }),
  automations: z.object({ count: z.number().int().nonnegative() }),
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
    .output(z.object({ id: z.string(), token: z.string(), prefix: z.string() })),
  importContacts: oc
    .route({ method: "POST", path: "/contacts/import", successStatus: 202 })
    .errors({
      ...authedErrors,
      CSV_TOO_LARGE: { status: 422, message: "CSVは25MB以下にしてください" },
      CSV_IDENTIFIER_MISSING: {
        status: 422,
        message: "CSVにはemailまたはexternal_id列が必要です",
      },
    })
    .input(z.object({ file: z.file().max(CSV_MAX_BYTES) }))
    .output(
      z.object({
        jobId: z.string(),
        rows: z.number().int().nonnegative(),
        parts: z.number().int().nonnegative(),
      }),
    ),
  exportContacts: oc
    .route({ method: "POST", path: "/contacts/export", successStatus: 202 })
    .errors(authedErrors)
    .output(z.object({ jobId: z.string() })),
  getDataJob: oc
    .route({ method: "GET", path: "/data-jobs/{id}" })
    .errors({
      ...authedErrors,
      DATA_JOB_NOT_FOUND: { status: 404, message: "データJobが見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(dataJobSchema),
  downloadContactExport: oc
    .route({ method: "GET", path: "/data-jobs/{id}/download" })
    .errors({
      ...authedErrors,
      EXPORT_NOT_READY: { status: 404, message: "Exportはまだ完了していません" },
      EXPORT_MISSING: { status: 404, message: "Exportファイルがありません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.file()),
  listDeadLetters: oc
    .route({ method: "GET", path: "/dead-letters" })
    .errors(authedErrors)
    .output(z.array(deadLetterRowSchema)),
  replayDeadLetter: oc
    .route({ method: "POST", path: "/dead-letters/{id}/replay" })
    .errors({
      ...authedErrors,
      DEAD_LETTER_NOT_FOUND: { status: 404, message: "DLQ項目が見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ replayed: z.literal(true) })),
};
