import { oc } from "@orpc/contract";
import * as z from "zod";

import { contactCreateSchema, contactSchema, contactUpdateSchema } from "./contact-schema";

import { workspaceErrors } from "../shared/errors";
import { contactListInputSchema, contactListResultSchema } from "./schema";

const contactNotFound = {
  CONTACT_NOT_FOUND: { status: 404, message: "連絡先が見つかりません" },
} as const;

export const contactTimelineEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
export type ContactTimelineEvent = z.infer<typeof contactTimelineEventSchema>;

export const contactsContract = {
  list: oc
    .route({ method: "GET", path: "/contacts" })
    .errors(workspaceErrors)
    .input(contactListInputSchema)
    .output(contactListResultSchema),
  get: oc
    .route({ method: "GET", path: "/contacts/{id}" })
    .errors({ ...workspaceErrors, ...contactNotFound })
    .input(z.object({ id: z.string().min(1) }))
    .output(contactSchema),
  timeline: oc
    .route({ method: "GET", path: "/contacts/{id}/timeline" })
    .errors({ ...workspaceErrors, ...contactNotFound })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.array(contactTimelineEventSchema)),
  recordEvent: oc
    .route({ method: "POST", path: "/contacts/{id}/events", successStatus: 202 })
    .errors({
      ...workspaceErrors,
      FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
      ...contactNotFound,
    })
    .input(
      z.object({
        id: z.string().min(1),
        eventName: z.string().trim().min(1).max(120),
        source: z.enum(["api", "webhook"]).default("api"),
        properties: z.record(z.string(), z.unknown()).default({}),
        occurredAt: z.iso.datetime().optional(),
      }),
    )
    .output(z.object({ eventId: z.string(), enrollmentCount: z.number().int().nonnegative() })),
  create: oc
    .route({ method: "POST", path: "/contacts", successStatus: 201 })
    .errors({
      ...workspaceErrors,
      FORBIDDEN: {
        status: 403,
        message: "この操作を行う権限がありません",
      },
      CONTACT_CONFLICT: {
        status: 409,
        message: "同じメールアドレスまたは外部IDの連絡先が既に存在します",
      },
    })
    .input(contactCreateSchema)
    .output(contactSchema),
  update: oc
    .route({ method: "PATCH", path: "/contacts/{id}" })
    .errors({
      ...workspaceErrors,
      FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
      CONTACT_NOT_FOUND: { status: 404, message: "連絡先が見つかりません" },
      CONTACT_ARCHIVED: {
        status: 409,
        message: "アーカイブ済みの連絡先は編集できません",
      },
    })
    .input(contactUpdateSchema.extend({ id: z.string().min(1) }))
    .output(contactSchema),
  archive: oc
    .route({ method: "DELETE", path: "/contacts/{id}" })
    .errors({
      ...workspaceErrors,
      FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
      CONTACT_NOT_FOUND: { status: 404, message: "連絡先が見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ archived: z.literal(true) })),
};
