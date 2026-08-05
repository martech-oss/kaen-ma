import * as z from "zod";

import { contentDocumentSchema } from "../web/content";

export const broadcastStatusSchema = z.enum([
  "draft",
  "scheduled",
  "sending",
  "completed",
  "cancelled",
]);
export type BroadcastStatus = z.infer<typeof broadcastStatusSchema>;

/** A broadcast joined with its segment and template, plus delivery counters. */
export const emailCampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  segmentId: z.string(),
  templateId: z.string(),
  topicId: z.string().nullable(),
  status: broadcastStatusSchema,
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  segmentName: z.string(),
  memberCount: z.number().int().nonnegative(),
  templateName: z.string(),
  subject: z.string().nullable(),
  recipientCount: z.number().int().nonnegative(),
  sentCount: z.number().int().nonnegative(),
  deliveredCount: z.number().int().nonnegative(),
});
export type EmailCampaign = z.infer<typeof emailCampaignSchema>;

export const emailTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.literal("transactional"),
  subject: z.string(),
  content: contentDocumentSchema,
  draftRevision: z.number().int().positive(),
  publishedRevision: z.number().int().positive().nullable(),
  hasUnpublishedChanges: z.boolean(),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sendable: z.boolean(),
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

export const emailTemplateWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  subject: z.string().trim().min(1).max(998),
  content: contentDocumentSchema,
});
export type EmailTemplateWrite = z.infer<typeof emailTemplateWriteSchema>;

export const emailTemplatePreviewSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export const messageVariableSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  value: z.string(),
  description: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MessageVariable = z.infer<typeof messageVariableSchema>;

export const broadcastSegmentOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
});
export type BroadcastSegmentOption = z.infer<typeof broadcastSegmentOptionSchema>;

export const subscriptionTopicOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
});
export type SubscriptionTopicOption = z.infer<typeof subscriptionTopicOptionSchema>;

export const broadcastWriteSchema = z.object({
  name: z.string().trim().min(1).max(191),
  segmentId: z.string().min(1),
  templateId: z.string().min(1),
  topicId: z.string().min(1).nullable().optional(),
  scheduledAt: z.iso.datetime().nullable().optional(),
});
export type BroadcastWrite = z.infer<typeof broadcastWriteSchema>;

export const messageVariableWriteSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,63}$/),
  name: z.string().trim().min(1).max(191),
  value: z.string().max(2_000),
  description: z.string().max(500).default(""),
});
export type MessageVariableWrite = z.infer<typeof messageVariableWriteSchema>;
