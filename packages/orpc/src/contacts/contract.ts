import { oc } from "@orpc/contract";

import { contactCreateSchema, contactSchema } from "@kaenma/shared/contacts";

import { workspaceErrors } from "../shared/errors";
import { contactListInputSchema, contactListResultSchema } from "./schema";

export const contactsContract = {
  list: oc
    .route({ method: "GET", path: "/contacts" })
    .errors(workspaceErrors)
    .input(contactListInputSchema)
    .output(contactListResultSchema),
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
};
