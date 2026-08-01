import * as z from "zod";

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

export const resendTemplateVariableSchema = z.object({
  key: z.string(),
  type: z.enum(["string", "number"]),
  fallbackValue: z.union([z.string(), z.number()]).nullable(),
});
export type ResendTemplateVariable = z.infer<typeof resendTemplateVariableSchema>;

export const emailTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.enum(["marketing", "transactional"]),
  resendTemplateId: z.string(),
  resendAlias: z.string().nullable(),
  subject: z.string().nullable(),
  remoteStatus: z.enum(["draft", "published"]),
  remoteCurrentVersionId: z.string(),
  hasUnpublishedVersions: z.boolean(),
  variables: z.array(resendTemplateVariableSchema),
  publishedAt: z.string().nullable(),
  lastSyncedAt: z.string(),
  syncError: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sendable: z.boolean(),
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

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
