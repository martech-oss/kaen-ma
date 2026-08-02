import { oc } from "@orpc/contract";
import * as z from "zod";

import { workspaceErrors } from "../shared/errors";
import { campaignDefinitionSchema } from "./schema";

const forbidden = {
  FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
} as const;
const base = { ...workspaceErrors, ...forbidden } as const;

export const campaignStatusSchema = z.enum(["draft", "active", "paused", "archived"]);

export const campaignRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: campaignStatusSchema,
  triggerSource: z.string().nullable(),
  enrollmentCount: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type CampaignRow = z.infer<typeof campaignRowSchema>;

export const campaignDraftSchema = z.object({
  graph: campaignDefinitionSchema,
  status: campaignStatusSchema,
});
export type CampaignDraft = z.infer<typeof campaignDraftSchema>;

export const campaignsContract = {
  list: oc
    .route({ method: "GET", path: "/campaigns" })
    .errors(workspaceErrors)
    .output(z.array(campaignRowSchema)),
  create: oc
    .route({ method: "POST", path: "/campaigns", successStatus: 201 })
    .errors(base)
    .input(campaignDefinitionSchema)
    .output(z.object({ id: z.string(), draftVersionId: z.string() })),
  getDraft: oc
    .route({ method: "GET", path: "/campaigns/{id}/draft" })
    .errors({
      ...workspaceErrors,
      CAMPAIGN_NOT_FOUND: { status: 404, message: "キャンペーンが見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(campaignDraftSchema),
  saveDraft: oc
    .route({ method: "PUT", path: "/campaigns/{id}/draft" })
    .errors({
      ...base,
      // Distinct from "campaign not found": the campaign exists but has no
      // editable draft, which is what the route reports here.
      DRAFT_NOT_EDITABLE: { status: 404, message: "編集可能な下書きが見つかりません" },
    })
    .input(campaignDefinitionSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ updated: z.literal(true) })),
  publish: oc
    .route({ method: "POST", path: "/campaigns/{id}/publish" })
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
    .route({ method: "POST", path: "/campaigns/{id}/status" })
    .errors({
      ...base,
      NOT_CHANGEABLE: { status: 409, message: "公開済みフローがありません" },
    })
    .input(z.object({ id: z.string().min(1), status: z.enum(["active", "paused"]) }))
    .output(z.object({ status: z.enum(["active", "paused"]) })),
  enroll: oc
    .route({ method: "POST", path: "/campaigns/{id}/enroll", successStatus: 202 })
    .errors({
      ...base,
      CAMPAIGN_NOT_ACTIVE: { status: 404, message: "公開中のキャンペーンがありません" },
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
    .route({ method: "GET", path: "/campaigns/{id}/analytics" })
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
