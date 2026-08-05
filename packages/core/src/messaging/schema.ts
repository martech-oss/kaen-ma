import * as z from "zod";

import { contentDocumentSchema } from "../web/content";

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

export const emailSegmentOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
});
export type EmailSegmentOption = z.infer<typeof emailSegmentOptionSchema>;

export const subscriptionTopicOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
});
export type SubscriptionTopicOption = z.infer<typeof subscriptionTopicOptionSchema>;

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

export const renderedEmailMessageSchema = z.object({
  kind: z.literal("email"),
  idempotencyKey: z.string(),
  workspaceId: z.string().optional(),
  deliveryId: z.string().optional(),
  purpose: z.enum(["transactional", "marketing"]),
  to: z.string(),
  from: z.object({ email: z.string(), name: z.string().optional() }),
  replyTo: z.string().optional(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type RenderedEmailMessage = z.infer<typeof renderedEmailMessageSchema>;

export const webhookChannelMessageSchema = z.object({
  kind: z.literal("webhook"),
  idempotencyKey: z.string(),
  workspaceId: z.string(),
  deliveryId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  endpointId: z.string().optional(),
});
export type WebhookChannelMessage = z.infer<typeof webhookChannelMessageSchema>;

export const channelMessageSchema = z.discriminatedUnion("kind", [
  renderedEmailMessageSchema,
  webhookChannelMessageSchema,
]);
export type ChannelMessage = z.infer<typeof channelMessageSchema>;
