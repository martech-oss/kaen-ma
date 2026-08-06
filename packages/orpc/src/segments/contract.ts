import { oc } from "@orpc/contract";
import * as z from "zod";

import { contactSchema } from "@openengage/core/contacts";
import { segmentFilterSchema, segmentRowSchema } from "@openengage/core/segments";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema } from "../shared/schemas";

export const segmentsContract = {
  list: oc
    .route({ method: "GET", path: "/segments" })
    .errors(workspaceErrors)
    .output(z.array(segmentRowSchema)),
  create: oc
    .route({ method: "POST", path: "/segments", successStatus: 201 })
    .errors({
      ...authedErrors,
      FILTER_REQUIRED: { status: 422, message: "動的セグメントには条件が必要です" },
    })
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        kind: z.enum(["static", "dynamic"]),
        filter: segmentFilterSchema.optional(),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        kind: z.enum(["static", "dynamic"]),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
  refresh: oc
    .route({ method: "POST", path: "/segments/{id}/refresh" })
    .errors({
      ...authedErrors,
      SEGMENT_NOT_FOUND: { status: 404, message: "セグメントが見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(ackSchema),
  preview: oc
    .route({ method: "POST", path: "/segments/preview" })
    .errors(authedErrors)
    .input(z.object({ filter: segmentFilterSchema }))
    .output(z.object({ contacts: z.array(contactSchema), capped: z.boolean() })),
};
