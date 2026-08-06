import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  companyAssignContactInputSchema,
  companyCreateSchema,
  companyDetailSchema,
  companyGetInputSchema,
  companyListInputSchema,
  companyRemoveContactInputSchema,
  companySchema,
  companySummarySchema,
  companyUpdateInputSchema,
} from "@openengage/core/contacts";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema } from "../shared/schemas";

const notFound = {
  COMPANY_NOT_FOUND: {
    status: 404,
    message: "会社が見つかりません",
  },
} as const;

const conflict = {
  COMPANY_CONFLICT: {
    status: 409,
    message: "同じドメインの会社が既に存在します",
  },
} as const;

export const companiesContract = {
  list: oc
    .route({ method: "GET", path: "/companies" })
    .errors(workspaceErrors)
    .input(companyListInputSchema)
    .output(z.array(companySummarySchema)),
  get: oc
    .route({ method: "GET", path: "/companies/{id}" })
    .errors({ ...workspaceErrors, ...notFound })
    .input(companyGetInputSchema)
    .output(companyDetailSchema),
  create: oc
    .route({ method: "POST", path: "/companies", successStatus: 201 })
    .errors({ ...authedErrors, ...conflict })
    .input(companyCreateSchema)
    .output(companySchema),
  update: oc
    .route({ method: "PATCH", path: "/companies/{id}" })
    .errors({ ...authedErrors, ...notFound, ...conflict })
    .input(companyUpdateInputSchema)
    .output(companySchema),
  assignContact: oc
    .route({ method: "POST", path: "/companies/{id}/contacts", successStatus: 201 })
    .errors({
      ...authedErrors,
      COMPANY_CONTACT_NOT_FOUND: {
        status: 404,
        message: "会社または連絡先が見つかりません",
      },
    })
    .input(companyAssignContactInputSchema)
    .output(ackSchema),
  removeContact: oc
    .route({ method: "DELETE", path: "/companies/{id}/contacts/{contactId}" })
    .errors({
      ...authedErrors,
      COMPANY_CONTACT_NOT_FOUND: {
        status: 404,
        message: "会社との関連が見つかりません",
      },
    })
    .input(companyRemoveContactInputSchema)
    .output(ackSchema),
};
