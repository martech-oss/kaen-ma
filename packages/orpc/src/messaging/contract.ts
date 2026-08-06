import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  emailTemplatePreviewSchema,
  emailSegmentOptionSchema,
  emailTemplateSchema,
  emailTemplateWriteSchema,
  messageVariableSchema,
  messageVariableWriteSchema,
  subscriptionTopicOptionSchema,
} from "@openengage/core/messaging";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema, idInput, notFoundError } from "../shared/schemas";

const base = authedErrors;
const archivedInput = z.object({ archived: z.boolean().default(false) });
const templateNotFound = notFoundError("TEMPLATE_NOT_FOUND", "メールテンプレートが見つかりません");
const variableNotFound = notFoundError(
  "MESSAGE_VARIABLE_NOT_FOUND",
  "メッセージ変数が見つかりません",
);

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
    .errors({ ...base, ...templateNotFound })
    .input(emailTemplateWriteSchema.extend({ id: z.string().min(1) }))
    .output(ackSchema),
  previewTemplate: oc
    .route({ method: "POST", path: "/emails/templates/preview" })
    .errors(base)
    .input(emailTemplateWriteSchema.pick({ subject: true, content: true }))
    .output(emailTemplatePreviewSchema),
  publishTemplate: oc
    .route({ method: "POST", path: "/emails/templates/{id}/publish" })
    .errors({ ...base, ...templateNotFound })
    .input(idInput)
    .output(ackSchema),
  archiveTemplate: oc
    .route({ method: "POST", path: "/emails/templates/{id}/archive" })
    .errors({ ...base, ...templateNotFound })
    .input(idInput)
    .output(ackSchema),

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
      ...variableNotFound,
      VARIABLE_CONFLICT: { status: 409, message: "同じキーが既に存在します" },
    })
    .input(messageVariableWriteSchema.extend({ id: z.string().min(1) }))
    .output(ackSchema),
  archiveVariable: oc
    .route({ method: "POST", path: "/emails/variables/{id}/archive" })
    .errors({ ...base, ...variableNotFound })
    .input(idInput)
    .output(ackSchema),

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
