import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  landingPageSchema,
  landingPageWriteSchema,
  signupFormSchema,
  signupFormWriteSchema,
  siteMessageSchema,
  siteMessageWriteSchema,
  siteTrackingSchema,
  siteTrackingWriteSchema,
} from "@openengage/core/web";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema, idInput, notFoundError } from "../shared/schemas";

const created = z.object({ id: z.string() });

function notFound<const Code extends string>(code: Code, message: string) {
  return { ...authedErrors, ...notFoundError(code, message) } as const;
}

export const websiteContract = {
  listForms: oc
    .route({ method: "GET", path: "/website/forms" })
    .errors(workspaceErrors)
    .output(z.array(signupFormSchema)),
  createForm: oc
    .route({ method: "POST", path: "/website/forms", successStatus: 201 })
    .errors(authedErrors)
    .input(signupFormWriteSchema)
    .output(created),
  updateForm: oc
    .route({ method: "PATCH", path: "/website/forms/{id}" })
    .errors(notFound("FORM_NOT_FOUND", "フォームが見つかりません"))
    .input(signupFormWriteSchema.extend({ id: z.string().min(1) }))
    .output(created),
  archiveForm: oc
    .route({ method: "POST", path: "/website/forms/{id}/archive" })
    .errors(notFound("FORM_NOT_FOUND", "フォームが見つかりません"))
    .input(idInput)
    .output(ackSchema),

  listPages: oc
    .route({ method: "GET", path: "/website/pages" })
    .errors(workspaceErrors)
    .output(z.array(landingPageSchema)),
  createPage: oc
    .route({ method: "POST", path: "/website/pages", successStatus: 201 })
    .errors(authedErrors)
    .input(landingPageWriteSchema)
    .output(z.object({ id: z.string(), versionId: z.string() })),
  updatePage: oc
    .route({ method: "PATCH", path: "/website/pages/{id}" })
    .errors({
      ...notFound("PAGE_NOT_FOUND", "ページが見つかりません"),
      PAGE_ARCHIVED: { status: 409, message: "アーカイブ済みページは編集できません" },
    })
    .input(landingPageWriteSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ id: z.string(), versionId: z.string() })),
  archivePage: oc
    .route({ method: "POST", path: "/website/pages/{id}/archive" })
    .errors(notFound("PAGE_NOT_FOUND", "ページが見つかりません"))
    .input(idInput)
    .output(ackSchema),

  listMessages: oc
    .route({ method: "GET", path: "/website/messages" })
    .errors(workspaceErrors)
    .output(z.array(siteMessageSchema)),
  createMessage: oc
    .route({ method: "POST", path: "/website/messages", successStatus: 201 })
    .errors(authedErrors)
    .input(siteMessageWriteSchema)
    .output(created),
  updateMessage: oc
    .route({ method: "PATCH", path: "/website/messages/{id}" })
    .errors(notFound("SITE_MESSAGE_NOT_FOUND", "サイトメッセージが見つかりません"))
    .input(siteMessageWriteSchema.extend({ id: z.string().min(1) }))
    .output(created),
  archiveMessage: oc
    .route({ method: "POST", path: "/website/messages/{id}/archive" })
    .errors(notFound("SITE_MESSAGE_NOT_FOUND", "サイトメッセージが見つかりません"))
    .input(idInput)
    .output(ackSchema),

  getTracking: oc
    .route({ method: "GET", path: "/website/tracking" })
    .errors(workspaceErrors)
    .output(siteTrackingSchema),
  updateTracking: oc
    .route({ method: "PUT", path: "/website/tracking" })
    .errors({
      ...authedErrors,
      INVALID_DOMAIN: { status: 422, message: "有効なドメインを入力してください" },
      TRACKING_DOMAIN_REQUIRED: {
        status: 422,
        message: "トラッキングを有効にするには許可ドメインが必要です",
      },
    })
    .input(siteTrackingWriteSchema)
    .output(ackSchema),
};
