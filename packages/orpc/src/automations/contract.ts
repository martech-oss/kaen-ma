import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  automationDefinitionSchema,
  automationDraftSchema,
  automationRowSchema,
} from "@openengage/core/automations";

import { workspaceErrors } from "../shared/errors";

const forbidden = {
  FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
} as const;
const base = { ...workspaceErrors, ...forbidden } as const;

export const automationsContract = {
  list: oc
    .route({ method: "GET", path: "/automations" })
    .errors(workspaceErrors)
    .output(z.array(automationRowSchema)),
  create: oc
    .route({ method: "POST", path: "/automations", successStatus: 201 })
    .errors(base)
    .input(automationDefinitionSchema)
    .output(z.object({ id: z.string(), draftVersionId: z.string() })),
  getDraft: oc
    .route({ method: "GET", path: "/automations/{id}/draft" })
    .errors({
      ...workspaceErrors,
      AUTOMATION_NOT_FOUND: { status: 404, message: "オートメーションが見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(automationDraftSchema),
  saveDraft: oc
    .route({ method: "PUT", path: "/automations/{id}/draft" })
    .errors({
      ...base,
      // Distinct from "automation not found": the automation exists but has
      // no editable draft, which is what the route reports here.
      DRAFT_NOT_EDITABLE: { status: 404, message: "編集可能な下書きが見つかりません" },
    })
    .input(automationDefinitionSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ updated: z.literal(true) })),
  publish: oc
    .route({ method: "POST", path: "/automations/{id}/publish" })
    .errors({
      ...base,
      DRAFT_NOT_FOUND: { status: 404, message: "下書きが見つかりません" },
      // Covers every publish-time rejection: an unpublishable graph, a missing
      // source node, or an email node pointing at an unsynced template. The
      // specific reason is supplied at throw time.
      INVALID_GRAPH: { status: 422, message: "公開できないグラフです" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ publishedVersionId: z.string(), draftVersionId: z.string() })),
  setStatus: oc
    .route({ method: "POST", path: "/automations/{id}/status" })
    .errors({
      ...base,
      NOT_CHANGEABLE: { status: 409, message: "公開済みフローがありません" },
    })
    .input(z.object({ id: z.string().min(1), status: z.enum(["active", "paused"]) }))
    .output(z.object({ status: z.enum(["active", "paused"]) })),
  enroll: oc
    .route({ method: "POST", path: "/automations/{id}/enroll", successStatus: 202 })
    .errors({
      ...base,
      AUTOMATION_NOT_ACTIVE: { status: 404, message: "公開中のオートメーションがありません" },
      SOURCE_MISSING: { status: 422, message: "Sourceノードがありません" },
      ALREADY_ENROLLED: { status: 409, message: "このイベントでは既に参加済みです" },
    })
    .input(
      z.object({
        id: z.string().min(1),
        contactId: z.string().min(1),
        sourceEventId: z.string().optional(),
      }),
    )
    .output(z.object({ enrollmentId: z.string(), jobId: z.string() })),
  analytics: oc
    .route({ method: "GET", path: "/automations/{id}/analytics" })
    .errors(workspaceErrors)
    .input(z.object({ id: z.string().min(1) }))
    .output(
      z.object({
        enrollments: z.array(
          z.object({ status: z.string(), count: z.number().int().nonnegative() }),
        ),
        deliveries: z.array(
          z.object({ status: z.string(), count: z.number().int().nonnegative() }),
        ),
      }),
    ),
};
