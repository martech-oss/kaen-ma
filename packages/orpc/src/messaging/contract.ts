import {
  emailTemplatePreviewSchema,
  emailSegmentOptionSchema,
  emailTemplateSchema,
  emailTemplateWriteSchema,
  messageVariableSchema,
  messageVariableWriteSchema,
  subscriptionTopicOptionSchema,
} from "@openengage/core/messaging";
import { oc } from "@orpc/contract";
import * as z from "zod";

import { workspaceErrors } from "../shared/errors";

const forbidden = {
  FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
} as const;
const base = { ...workspaceErrors, ...forbidden } as const;
const archivedInput = z.object({ archived: z.boolean().default(false) });
const idInput = z.object({ id: z.string().min(1) });

export const emailsContract = {
  listTemplates: oc
    .route({ method: "GET", path: "/emails/templates" })
    .errors(workspaceErrors)
    .input(archivedInput)
    .output(z.array(emailTemplateSchema)),
  createTemplate: oc
    .route({ method: "POST", path: "/emails/templates", successStatus: 201 })
    .errors(base)
    .input(emailTemplateWriteSchema)
    .output(z.object({ id: z.string() })),
  updateTemplate: oc
    .route({ method: "PATCH", path: "/emails/templates/{id}" })
    .errors({ ...base, NOT_FOUND: { status: 404, message: "メールテンプレートが見つかりません" } })
    .input(emailTemplateWriteSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ updated: z.literal(true) })),
  previewTemplate: oc
    .route({ method: "POST", path: "/emails/templates/preview" })
    .errors(base)
    .input(emailTemplateWriteSchema.pick({ subject: true, content: true }))
    .output(emailTemplatePreviewSchema),
  publishTemplate: oc
    .route({ method: "POST", path: "/emails/templates/{id}/publish" })
    .errors({ ...base, NOT_FOUND: { status: 404, message: "メールテンプレートが見つかりません" } })
    .input(idInput)
    .output(z.object({ published: z.literal(true) })),
  archiveTemplate: oc
    .route({ method: "POST", path: "/emails/templates/{id}/archive" })
    .errors({ ...base, NOT_FOUND: { status: 404, message: "メールテンプレートが見つかりません" } })
    .input(idInput)
    .output(z.object({ archived: z.literal(true) })),

  listVariables: oc
    .route({ method: "GET", path: "/emails/variables" })
    .errors(workspaceErrors)
    .input(archivedInput)
    .output(z.array(messageVariableSchema)),
  createVariable: oc
    .route({ method: "POST", path: "/emails/variables", successStatus: 201 })
    .errors({ ...base, VARIABLE_CONFLICT: { status: 409, message: "同じキーが既に存在します" } })
    .input(messageVariableWriteSchema)
    .output(z.object({ id: z.string() })),
  updateVariable: oc
    .route({ method: "PATCH", path: "/emails/variables/{id}" })
    .errors({
      ...base,
      NOT_FOUND: { status: 404, message: "メッセージ変数が見つかりません" },
      VARIABLE_CONFLICT: { status: 409, message: "同じキーが既に存在します" },
    })
    .input(messageVariableWriteSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ updated: z.literal(true) })),
  archiveVariable: oc
    .route({ method: "POST", path: "/emails/variables/{id}/archive" })
    .errors({ ...base, NOT_FOUND: { status: 404, message: "メッセージ変数が見つかりません" } })
    .input(idInput)
    .output(z.object({ archived: z.literal(true) })),

  // Admin-UI option lists. Distinct REST paths so they never collide with the
  // canonical /segments and /subscription-topics resources when both are
  // exposed through the OpenAPI surface.
  listSegmentOptions: oc
    .route({ method: "GET", path: "/emails/options/segments" })
    .errors(workspaceErrors)
    .output(z.array(emailSegmentOptionSchema)),
  listTopicOptions: oc
    .route({ method: "GET", path: "/emails/options/topics" })
    .errors(workspaceErrors)
    .output(z.array(subscriptionTopicOptionSchema)),
};
