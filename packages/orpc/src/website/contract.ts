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
} from "@kaenma/shared/website";

import { workspaceErrors } from "../shared/errors";

const forbidden = {
  FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
} as const;

const idInput = z.object({ id: z.string().min(1) });
const created = z.object({ id: z.string() });
const archived = z.object({ archived: z.literal(true) });

function notFound(message: string) {
  return { ...workspaceErrors, ...forbidden, NOT_FOUND: { status: 404, message } } as const;
}

export const websiteContract = {
  listForms: oc
    .route({ method: "GET", path: "/forms" })
    .errors(workspaceErrors)
    .output(z.array(signupFormSchema)),
  createForm: oc
    .route({ method: "POST", path: "/forms", successStatus: 201 })
    .errors({ ...workspaceErrors, ...forbidden })
    .input(signupFormWriteSchema)
    .output(created),
  updateForm: oc
    .route({ method: "PATCH", path: "/forms/{id}" })
    .errors(notFound("フォームが見つかりません"))
    .input(signupFormWriteSchema.extend({ id: z.string().min(1) }))
    .output(created),
  archiveForm: oc
    .route({ method: "POST", path: "/forms/{id}/archive" })
    .errors(notFound("フォームが見つかりません"))
    .input(idInput)
    .output(archived),

  listPages: oc
    .route({ method: "GET", path: "/pages" })
    .errors(workspaceErrors)
    .output(z.array(landingPageSchema)),
  createPage: oc
    .route({ method: "POST", path: "/pages", successStatus: 201 })
    .errors({ ...workspaceErrors, ...forbidden })
    .input(landingPageWriteSchema)
    .output(z.object({ id: z.string(), versionId: z.string() })),
  updatePage: oc
    .route({ method: "PATCH", path: "/pages/{id}" })
    .errors({
      ...notFound("ページが見つかりません"),
      PAGE_ARCHIVED: { status: 409, message: "アーカイブ済みページは編集できません" },
    })
    .input(landingPageWriteSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ id: z.string(), versionId: z.string() })),
  archivePage: oc
    .route({ method: "POST", path: "/pages/{id}/archive" })
    .errors(notFound("ページが見つかりません"))
    .input(idInput)
    .output(archived),

  listMessages: oc
    .route({ method: "GET", path: "/site-messages" })
    .errors(workspaceErrors)
    .output(z.array(siteMessageSchema)),
  createMessage: oc
    .route({ method: "POST", path: "/site-messages", successStatus: 201 })
    .errors({ ...workspaceErrors, ...forbidden })
    .input(siteMessageWriteSchema)
    .output(created),
  updateMessage: oc
    .route({ method: "PATCH", path: "/site-messages/{id}" })
    .errors(notFound("サイトメッセージが見つかりません"))
    .input(siteMessageWriteSchema.extend({ id: z.string().min(1) }))
    .output(created),
  archiveMessage: oc
    .route({ method: "POST", path: "/site-messages/{id}/archive" })
    .errors(notFound("サイトメッセージが見つかりません"))
    .input(idInput)
    .output(archived),

  getTracking: oc
    .route({ method: "GET", path: "/site-tracking" })
    .errors(workspaceErrors)
    .output(siteTrackingSchema),
  updateTracking: oc
    .route({ method: "PUT", path: "/site-tracking" })
    .errors({
      ...workspaceErrors,
      ...forbidden,
      INVALID_DOMAIN: { status: 422, message: "有効なドメインを入力してください" },
      TRACKING_DOMAIN_REQUIRED: {
        status: 422,
        message: "トラッキングを有効にするには許可ドメインが必要です",
      },
    })
    .input(siteTrackingWriteSchema)
    .output(z.object({ saved: z.literal(true) })),
};
