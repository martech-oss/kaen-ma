import * as z from "zod";

export const companyListInputSchema = z.object({
  query: z.string().trim().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type CompanyListInput = z.infer<typeof companyListInputSchema>;

export const companyGetInputSchema = z.object({
  id: z.string().min(1),
});

export const companyUpdateInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(191).optional(),
  domain: z.string().trim().max(253).nullable().optional(),
});

export const companyAssignContactInputSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  title: z.string().trim().max(191).optional(),
  isPrimary: z.boolean().default(false),
});

export const companyRemoveContactInputSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
});
