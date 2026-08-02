import * as z from "zod";

import { contactSchema } from "./contact-schema";

/**
 * Chip shape embedded in contact summaries. The management-row variant with
 * a count lives in resource-schema.ts (tagSchema).
 */
export const contactTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
});

export const contactCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  title: z.string().nullable(),
  is_primary: z.boolean(),
});

export const contactSummarySchema = contactSchema.extend({
  tags: z.array(contactTagSchema),
  companies: z.array(contactCompanySchema),
});

export type ContactSummary = z.infer<typeof contactSummarySchema>;

export const contactListInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  query: z.string().trim().optional(),
  status: z.enum(["active", "archived", "anonymous", "all"]).optional(),
  stage: z.string().optional(),
  tagId: z.string().optional(),
  companyId: z.string().optional(),
  segmentId: z.string().optional(),
  scoreMin: z.number().optional(),
  scoreMax: z.number().optional(),
  sort: z.enum(["createdAt", "updatedAt", "score", "name", "email"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});

export type ContactListInput = z.infer<typeof contactListInputSchema>;

export const contactListResultSchema = z.object({
  items: z.array(contactSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
});

export type ContactListResult = z.infer<typeof contactListResultSchema>;
