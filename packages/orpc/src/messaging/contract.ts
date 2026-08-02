import { oc } from "@orpc/contract";
import * as z from "zod";

import { workspaceErrors } from "../shared/errors";
import {
  broadcastSegmentOptionSchema,
  broadcastWriteSchema,
  emailCampaignSchema,
  emailTemplateSchema,
  messageVariableSchema,
  messageVariableWriteSchema,
  subscriptionTopicOptionSchema,
} from "./schema";

const forbidden = {
  FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
} as const;
const base = { ...workspaceErrors, ...forbidden } as const;
const archivedInput = z.object({ archived: z.boolean().default(false) });
const idInput = z.object({ id: z.string().min(1) });

const invalidResources = {
  INVALID_BROADCAST_RESOURCES: {
    status: 422,
    message: "SegmentまたはMarketingテンプレートが見つかりません",
  },
} as const;

export const emailsContract = {
  listCampaigns: oc
    .route({ method: "GET", path: "/broadcasts" })
    .errors(workspaceErrors)
    .input(archivedInput)
    .output(z.array(emailCampaignSchema)),
  getCampaign: oc
    .route({ method: "GET", path: "/broadcasts/{id}" })
    .errors({
      ...workspaceErrors,
      BROADCAST_NOT_FOUND: { status: 404, message: "メールキャンペーンが見つかりません" },
    })
    .input(idInput)
    .output(emailCampaignSchema),
  createCampaign: oc
    .route({ method: "POST", path: "/broadcasts", successStatus: 201 })
    .errors({ ...base, ...invalidResources })
    .input(broadcastWriteSchema)
    .output(z.object({ id: z.string() })),
  updateCampaign: oc
    .route({ method: "PATCH", path: "/broadcasts/{id}" })
    .errors({
      ...base,
      ...invalidResources,
      NOT_EDITABLE: {
        status: 409,
        message: "送信済みまたはアーカイブ済みのメールキャンペーンは編集できません",
      },
    })
    .input(broadcastWriteSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ updated: z.literal(true) })),
  startCampaign: oc
    .route({ method: "POST", path: "/broadcasts/{id}/start", successStatus: 202 })
    .errors({
      ...base,
      RESEND_NOT_CONFIGURED: {
        status: 422,
        message: "RESEND_SEND_API_KEY環境変数が設定されていません",
      },
      NOT_STARTABLE: { status: 409, message: "Broadcastは既に開始済みか存在しません" },
    })
    .input(idInput)
    .output(z.object({ started: z.literal(true) })),
  archiveCampaign: oc
    .route({ method: "POST", path: "/broadcasts/{id}/archive" })
    .errors({
      ...base,
      NOT_ARCHIVABLE: { status: 409, message: "送信中のメールキャンペーンはアーカイブできません" },
    })
    .input(idInput)
    .output(z.object({ archived: z.literal(true) })),

  listTemplates: oc
    .route({ method: "GET", path: "/email-templates" })
    .errors(workspaceErrors)
    .input(archivedInput)
    .output(z.array(emailTemplateSchema)),
  importTemplate: oc
    .route({ method: "POST", path: "/email-templates", successStatus: 201 })
    .errors({
      ...base,
      REMOTE_TEMPLATE_UNAVAILABLE: {
        status: 422,
        message: "Resend Templateを取得できません",
      },
      REMOTE_TEMPORARILY_UNAVAILABLE: {
        status: 503,
        message: "Resendへ一時的に接続できません",
      },
      ALREADY_REGISTERED: {
        status: 409,
        message: "このResend Templateは既に登録されています",
      },
    })
    .input(
      z.object({
        resendTemplateId: z.string().trim().min(1).max(191),
        purpose: z.enum(["marketing", "transactional"]),
      }),
    )
    .output(z.object({ id: z.string() })),
  syncTemplate: oc
    .route({ method: "POST", path: "/email-templates/{id}/sync" })
    .errors({
      ...base,
      NOT_FOUND: { status: 404, message: "メールテンプレートが見つかりません" },
      REMOTE_TEMPLATE_UNAVAILABLE: {
        status: 422,
        message: "Resend Templateを取得できません",
      },
      REMOTE_TEMPORARILY_UNAVAILABLE: {
        status: 503,
        message: "Resendへ一時的に接続できません",
      },
    })
    .input(idInput)
    .output(z.object({ synced: z.literal(true) })),
  archiveTemplate: oc
    .route({ method: "POST", path: "/email-templates/{id}/archive" })
    .errors({ ...base, NOT_FOUND: { status: 404, message: "メールテンプレートが見つかりません" } })
    .input(idInput)
    .output(z.object({ archived: z.literal(true) })),

  listVariables: oc
    .route({ method: "GET", path: "/message-variables" })
    .errors(workspaceErrors)
    .input(archivedInput)
    .output(z.array(messageVariableSchema)),
  createVariable: oc
    .route({ method: "POST", path: "/message-variables", successStatus: 201 })
    .errors({ ...base, VARIABLE_CONFLICT: { status: 409, message: "同じキーが既に存在します" } })
    .input(messageVariableWriteSchema)
    .output(z.object({ id: z.string() })),
  updateVariable: oc
    .route({ method: "PATCH", path: "/message-variables/{id}" })
    .errors({
      ...base,
      NOT_FOUND: { status: 404, message: "メッセージ変数が見つかりません" },
      VARIABLE_CONFLICT: { status: 409, message: "同じキーが既に存在します" },
    })
    .input(messageVariableWriteSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ updated: z.literal(true) })),
  archiveVariable: oc
    .route({ method: "POST", path: "/message-variables/{id}/archive" })
    .errors({ ...base, NOT_FOUND: { status: 404, message: "メッセージ変数が見つかりません" } })
    .input(idInput)
    .output(z.object({ archived: z.literal(true) })),

  // Admin-UI option lists. Distinct REST paths so they never collide with the
  // canonical /segments and /subscription-topics resources when both are
  // exposed through the OpenAPI surface.
  listSegmentOptions: oc
    .route({ method: "GET", path: "/email-options/segments" })
    .errors(workspaceErrors)
    .output(z.array(broadcastSegmentOptionSchema)),
  listTopicOptions: oc
    .route({ method: "GET", path: "/email-options/topics" })
    .errors(workspaceErrors)
    .output(z.array(subscriptionTopicOptionSchema)),
};
