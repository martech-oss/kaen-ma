import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  contactBulkActionSchema,
  contactListCreateSchema,
  contactListSchema,
  contactOptionsSchema,
  contactProfileSchema,
  contactSchema,
  contactScoreAdjustSchema,
  tagCreateSchema,
  tagSchema,
} from "@kaenma/shared/contacts";

import { workspaceErrors } from "../shared/errors";

const forbidden = {
  FORBIDDEN: {
    status: 403,
    message: "この操作を行う権限がありません",
  },
} as const;

const contactNotFound = {
  CONTACT_NOT_FOUND: {
    status: 404,
    message: "連絡先が見つかりません",
  },
} as const;

/** Adding or removing a relation fails with 409 when the pairing is not allowed. */
function relationErrors(message: string) {
  return {
    ...workspaceErrors,
    ...forbidden,
    RELATION_REJECTED: { status: 409, message },
  } as const;
}

const contactRelationInput = z.object({
  contactId: z.string().min(1),
  resourceId: z.string().min(1),
});

export const contactResourcesContract = {
  options: oc
    .route({ method: "GET", path: "/contact-options" })
    .errors(workspaceErrors)
    .output(contactOptionsSchema),
  profile: oc
    .route({ method: "GET", path: "/contacts/{contactId}/profile" })
    .errors({ ...workspaceErrors, ...contactNotFound })
    .input(z.object({ contactId: z.string().min(1) }))
    .output(contactProfileSchema),
  createTag: oc
    .route({ method: "POST", path: "/tags", successStatus: 201 })
    .errors({
      ...workspaceErrors,
      ...forbidden,
      TAG_CONFLICT: { status: 409, message: "同名のタグが既に存在します" },
    })
    .input(tagCreateSchema)
    .output(tagSchema.omit({ contactCount: true })),
  createList: oc
    .route({ method: "POST", path: "/contact-lists", successStatus: 201 })
    .errors({
      ...workspaceErrors,
      ...forbidden,
      LIST_CONFLICT: { status: 409, message: "同名のリストが既に存在します" },
    })
    .input(contactListCreateSchema)
    .output(contactListSchema.omit({ contactCount: true })),
  addTag: oc
    .route({ method: "POST", path: "/contacts/{contactId}/tags", successStatus: 201 })
    .errors(relationErrors("タグを追加できませんでした"))
    .input(contactRelationInput)
    .output(z.object({ assigned: z.literal(true) })),
  removeTag: oc
    .route({ method: "DELETE", path: "/contacts/{contactId}/tags/{resourceId}" })
    .errors(relationErrors("タグを削除できませんでした"))
    .input(contactRelationInput)
    .output(z.object({ removed: z.literal(true) })),
  addList: oc
    .route({ method: "POST", path: "/contacts/{contactId}/lists", successStatus: 201 })
    .errors(relationErrors("リストへ追加できませんでした"))
    .input(contactRelationInput)
    .output(z.object({ assigned: z.literal(true) })),
  removeList: oc
    .route({ method: "DELETE", path: "/contacts/{contactId}/lists/{resourceId}" })
    .errors(relationErrors("リストから削除できませんでした"))
    .input(contactRelationInput)
    .output(z.object({ removed: z.literal(true) })),
  addSegment: oc
    .route({ method: "POST", path: "/contacts/{contactId}/segments", successStatus: 201 })
    .errors(relationErrors("静的セグメントへ追加できませんでした"))
    .input(contactRelationInput)
    .output(z.object({ assigned: z.literal(true) })),
  removeSegment: oc
    .route({ method: "DELETE", path: "/contacts/{contactId}/segments/{resourceId}" })
    .errors({ ...workspaceErrors, ...forbidden })
    .input(contactRelationInput)
    .output(z.object({ removed: z.literal(true) })),
  adjustScore: oc
    .route({ method: "POST", path: "/contacts/{contactId}/score" })
    .errors({
      ...workspaceErrors,
      ...forbidden,
      SCORE_NOT_ADJUSTABLE: { status: 409, message: "スコアを変更できませんでした" },
    })
    .input(contactScoreAdjustSchema.extend({ contactId: z.string().min(1) }))
    .output(contactSchema),
  restore: oc
    .route({ method: "POST", path: "/contacts/{contactId}/restore" })
    .errors({
      ...workspaceErrors,
      ...forbidden,
      CONTACT_NOT_ARCHIVED: { status: 404, message: "復元できる連絡先が見つかりません" },
    })
    .input(z.object({ contactId: z.string().min(1) }))
    .output(z.object({ restored: z.literal(true) })),
  bulkAction: oc
    .route({ method: "POST", path: "/contact-actions" })
    .errors({
      ...workspaceErrors,
      ...forbidden,
      ARCHIVE_FORBIDDEN: { status: 403, message: "アーカイブ操作にはAdmin権限が必要です" },
      RESOURCE_REQUIRED: { status: 422, message: "対象を選択してください" },
    })
    .input(contactBulkActionSchema)
    .output(z.object({ updated: z.number().int().nonnegative() })),
};
