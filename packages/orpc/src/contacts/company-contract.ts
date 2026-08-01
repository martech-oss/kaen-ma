import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  accountCreateSchema,
  accountDetailSchema,
  accountSchema,
  accountSummarySchema,
} from "./company-dto";

import { workspaceErrors } from "../shared/errors";
import {
  accountAssignContactInputSchema,
  accountGetInputSchema,
  accountListInputSchema,
  accountRemoveContactInputSchema,
  accountUpdateInputSchema,
} from "./company-schema";

const forbidden = {
  FORBIDDEN: {
    status: 403,
    message: "この操作を行う権限がありません",
  },
} as const;

const notFound = {
  ACCOUNT_NOT_FOUND: {
    status: 404,
    message: "アカウントが見つかりません",
  },
} as const;

const conflict = {
  ACCOUNT_CONFLICT: {
    status: 409,
    message: "同じドメインのアカウントが既に存在します",
  },
} as const;

export const accountsContract = {
  list: oc
    .route({ method: "GET", path: "/accounts" })
    .errors(workspaceErrors)
    .input(accountListInputSchema)
    .output(z.array(accountSummarySchema)),
  get: oc
    .route({ method: "GET", path: "/accounts/{id}" })
    .errors({ ...workspaceErrors, ...notFound })
    .input(accountGetInputSchema)
    .output(accountDetailSchema),
  create: oc
    .route({ method: "POST", path: "/accounts", successStatus: 201 })
    .errors({ ...workspaceErrors, ...forbidden, ...conflict })
    .input(accountCreateSchema)
    .output(accountSchema),
  update: oc
    .route({ method: "PATCH", path: "/accounts/{id}" })
    .errors({ ...workspaceErrors, ...forbidden, ...notFound, ...conflict })
    .input(accountUpdateInputSchema)
    .output(accountSchema),
  assignContact: oc
    .route({ method: "POST", path: "/accounts/{id}/contacts", successStatus: 201 })
    .errors({
      ...workspaceErrors,
      ...forbidden,
      ACCOUNT_CONTACT_NOT_FOUND: {
        status: 404,
        message: "アカウントまたは連絡先が見つかりません",
      },
    })
    .input(accountAssignContactInputSchema)
    .output(z.object({ assigned: z.literal(true) })),
  removeContact: oc
    .route({ method: "DELETE", path: "/accounts/{id}/contacts/{contactId}" })
    .errors({
      ...workspaceErrors,
      ...forbidden,
      ACCOUNT_CONTACT_NOT_FOUND: {
        status: 404,
        message: "アカウントとの関連が見つかりません",
      },
    })
    .input(accountRemoveContactInputSchema)
    .output(z.object({ removed: z.literal(true) })),
};
