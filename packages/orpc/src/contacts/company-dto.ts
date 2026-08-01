import * as z from "zod";

const accountFieldsSchema = z.object({
  name: z.string().trim().min(1).max(191),
  domain: z
    .string()
    .trim()
    .max(253)
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
      "domain must be a hostname such as example.com",
    )
    .optional(),
});

export const accountCreateSchema = accountFieldsSchema;
export type AccountCreate = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = accountFieldsSchema.partial().extend({
  domain: accountFieldsSchema.shape.domain.unwrap().nullable().optional(),
});
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;

export const accountSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Account = z.infer<typeof accountSchema>;

export const accountSummarySchema = accountSchema.extend({
  contactCount: z.number().int().nonnegative(),
});
export type AccountSummary = z.infer<typeof accountSummarySchema>;

/** A contact as listed on an account, with its account-specific role fields. */
export const accountContactSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  stage: z.string(),
  score: z.number(),
  status: z.enum(["active", "archived", "anonymous"]),
  title: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type AccountContact = z.infer<typeof accountContactSchema>;

export const accountDetailSchema = accountSchema.extend({
  contacts: z.array(accountContactSchema),
});
export type AccountDetail = z.infer<typeof accountDetailSchema>;
