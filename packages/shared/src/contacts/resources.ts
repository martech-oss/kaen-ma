import * as z from "zod";

import { segmentFilterSchema } from "../segments/schema";
import { contactSchema } from "./schema";

export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
  contactCount: z.number().int().nonnegative(),
});
export type Tag = z.infer<typeof tagSchema>;

export const contactListSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  color: z.string(),
  contactCount: z.number().int().nonnegative(),
});
export type ContactList = z.infer<typeof contactListSchema>;

export const segmentOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z.enum(["static", "dynamic"]),
  filterAst: segmentFilterSchema.nullable(),
  memberCount: z.number().int().nonnegative(),
  evaluatedAt: z.string().nullable(),
});
export type SegmentOption = z.infer<typeof segmentOptionSchema>;

export const accountOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  contactCount: z.number().int().nonnegative(),
});
export type AccountOption = z.infer<typeof accountOptionSchema>;

export const stageCountSchema = z.object({
  stage: z.string(),
  contactCount: z.number().int().nonnegative(),
});

/** Everything the contact list page needs to render its filters. */
export const contactOptionsSchema = z.object({
  tags: z.array(tagSchema),
  lists: z.array(contactListSchema),
  segments: z.array(segmentOptionSchema),
  accounts: z.array(accountOptionSchema),
  stages: z.array(stageCountSchema),
});
export type ContactOptions = z.infer<typeof contactOptionsSchema>;

export const contactProfileSchema = z.object({
  contact: contactSchema,
  tags: z.array(tagSchema.omit({ contactCount: true })),
  lists: z.array(
    contactListSchema
      .omit({ contactCount: true, description: true })
      .extend({ status: z.string(), updatedAt: z.string() }),
  ),
  segments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["static", "dynamic"]),
      source: z.string(),
      joinedAt: z.string(),
    }),
  ),
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      domain: z.string().nullable(),
      title: z.string().nullable(),
      isPrimary: z.boolean(),
    }),
  ),
  scoreEvents: z.array(
    z.object({
      id: z.string(),
      delta: z.number().int(),
      total: z.number().int(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
  timeline: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      resourceType: z.string().nullable(),
      resourceId: z.string().nullable(),
      properties: z.record(z.string(), z.unknown()),
      occurredAt: z.string(),
    }),
  ),
});
export type ContactProfile = z.infer<typeof contactProfileSchema>;

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#64748b"),
});
export type TagCreate = z.infer<typeof tagCreateSchema>;

export const contactListCreateSchema = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(2_000).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6366f1"),
});
export type ContactListCreate = z.infer<typeof contactListCreateSchema>;

export const contactBulkActionSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["archive", "restore", "add_tag", "remove_tag", "add_list", "remove_list"]),
  resourceId: z.string().min(1).optional(),
});
export type ContactBulkAction = z.infer<typeof contactBulkActionSchema>;

export const contactScoreAdjustSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-10_000)
    .max(10_000)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(500),
});
export type ContactScoreAdjust = z.infer<typeof contactScoreAdjustSchema>;
