import * as z from "zod";

import { segmentOperatorSchema, segmentValueSchema } from "./segments/schema";

export * from "./contacts/index";
export * from "./segments/index";

export const workspaceRoleSchema = z.enum(["owner", "admin", "marketer", "analyst", "viewer"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const messagePurposeSchema = z.enum(["transactional", "marketing"]);
export type MessagePurpose = z.infer<typeof messagePurposeSchema>;

export const channelSchema = z.enum(["email", "webhook"]);
export type Channel = z.infer<typeof channelSchema>;

export const deliveryEventTypeSchema = z.enum([
  "accepted",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "unsubscribed",
  "replied",
  "failed",
]);
export type DeliveryEventType = z.infer<typeof deliveryEventTypeSchema>;

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

export const sourceNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("source"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.discriminatedUnion("source", [
    z.object({
      source: z.literal("segment_joined"),
      segmentId: z.string().min(1),
      reentry: z.enum(["once", "every_time"]).default("once"),
    }),
    z.object({
      source: z.literal("form_submitted"),
      formId: z.string().min(1),
      reentry: z.enum(["once", "every_time"]).default("once"),
    }),
    z.object({
      source: z.literal("contact_created"),
      reentry: z.literal("once").default("once"),
    }),
    z.object({
      source: z.literal("api_event"),
      eventName: z.string().trim().min(1).max(120),
      reentry: z.enum(["once", "every_time"]).default("every_time"),
    }),
    z.object({
      source: z.literal("webhook_event"),
      eventName: z.string().trim().min(1).max(120),
      reentry: z.enum(["once", "every_time"]).default("every_time"),
    }),
    z.object({
      source: z.literal("contact_inactive"),
      days: z.number().int().min(1).max(3_650),
      reentry: z.literal("once").default("once"),
    }),
  ]),
});

export const actionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("action"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("send_email"),
      templateVersionId: z.string(),
      purpose: messagePurposeSchema,
      provider: z.enum(["cloudflare", "resend"]),
      topicId: z.string().optional(),
    }),
    z.object({ action: z.literal("send_webhook"), endpointId: z.string() }),
    z.object({ action: z.literal("add_tag"), tagId: z.string() }),
    z.object({ action: z.literal("remove_tag"), tagId: z.string() }),
    z.object({ action: z.literal("add_segment"), segmentId: z.string() }),
    z.object({ action: z.literal("remove_segment"), segmentId: z.string() }),
    z.object({ action: z.literal("change_score"), amount: z.number().int() }),
    z.object({
      action: z.literal("update_field"),
      field: z.string().min(1).max(191),
      value: z.unknown(),
    }),
  ]),
});

const predicateSchema = z.object({
  field: z.string().min(1).max(191),
  operator: segmentOperatorSchema,
  value: segmentValueSchema,
});

export const conditionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("condition"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: predicateSchema,
});

export const decisionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("decision"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.object({
    event: z.enum([
      "opened",
      "clicked",
      "replied",
      "page_viewed",
      "form_submitted",
      "custom_event",
    ]),
    resourceId: z.string().optional(),
    withinMinutes: z.number().int().positive().max(525_600),
  }),
});

export const delayNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("delay"),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("relative"), minutes: z.number().int().min(1).max(525_600) }),
    z.object({ mode: z.literal("absolute"), at: z.iso.datetime() }),
    z.object({
      mode: z.literal("window"),
      minutes: z.number().int().min(1).max(525_600),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(1).max(24),
    }),
  ]),
});

export const campaignNodeSchema = z.discriminatedUnion("type", [
  sourceNodeSchema,
  actionNodeSchema,
  conditionNodeSchema,
  decisionNodeSchema,
  delayNodeSchema,
]);
export type CampaignNode = z.infer<typeof campaignNodeSchema>;

export const campaignEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  branch: z.enum(["next", "yes", "no", "timeout"]).default("next"),
});
export type CampaignEdge = z.infer<typeof campaignEdgeSchema>;

export const campaignDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().max(2_000).default(""),
  timezone: z.string().min(1).default("UTC"),
  nodes: z.array(campaignNodeSchema).min(1).max(500),
  edges: z.array(campaignEdgeSchema).max(1_000),
});
export type CampaignDefinition = z.infer<typeof campaignDefinitionSchema>;

export type EmailBlock =
  | { id: string; type: "text"; html: string }
  | { id: string; type: "image"; src: string; alt: string; href?: string | undefined }
  | { id: string; type: "button"; label: string; href: string; color: string }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; height: number }
  | {
      id: string;
      type: "conditional";
      field: string;
      equals: string | number | boolean;
      blocks: EmailBlock[];
    };

export const emailBlockSchema: z.ZodType<EmailBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ id: z.string(), type: z.literal("text"), html: z.string().max(100_000) }),
    z.object({
      id: z.string(),
      type: z.literal("image"),
      src: z.url(),
      alt: z.string().max(500),
      href: z.url().optional(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("button"),
      label: z.string().max(200),
      href: z.string().max(2_000),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    z.object({ id: z.string(), type: z.literal("divider") }),
    z.object({
      id: z.string(),
      type: z.literal("spacer"),
      height: z.number().int().min(4).max(200),
    }),
    z.object({
      id: z.string(),
      type: z.literal("conditional"),
      field: z.string().max(191),
      equals: z.union([z.string(), z.number(), z.boolean()]),
      blocks: z.array(emailBlockSchema).max(50),
    }),
  ]),
);

export const contentDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#f4f5f7"),
  contentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#ffffff"),
  width: z.number().int().min(320).max(720).default(600),
  blocks: z.array(emailBlockSchema).max(200),
});
export type ContentDocument = z.infer<typeof contentDocumentSchema>;

export const campaignQueueMessageSchema = z.object({
  kind: z.literal("campaign_job"),
  jobId: z.string(),
  leaseId: z.string(),
});
export type CampaignQueueMessage = z.infer<typeof campaignQueueMessageSchema>;

export const deliveryQueueMessageSchema = z.object({
  kind: z.literal("delivery"),
  deliveryId: z.string(),
});
export type DeliveryQueueMessage = z.infer<typeof deliveryQueueMessageSchema>;

export const archiveQueueMessageSchema = z.object({
  kind: z.literal("archive"),
  before: z.string(),
  cursor: z.string().optional(),
});
export type ArchiveQueueMessage = z.infer<typeof archiveQueueMessageSchema>;

export const broadcastQueueMessageSchema = z.object({
  kind: z.literal("broadcast_batch"),
  broadcastId: z.string(),
  phase: z.enum(["snapshot", "delivery"]).default("snapshot"),
  cursor: z.string().optional(),
});
export type BroadcastQueueMessage = z.infer<typeof broadcastQueueMessageSchema>;

export const contactImportQueueMessageSchema = z.object({
  kind: z.literal("contact_import"),
  importJobId: z.string(),
  part: z.number().int().nonnegative(),
  totalParts: z.number().int().positive(),
});
export type ContactImportQueueMessage = z.infer<typeof contactImportQueueMessageSchema>;

export const contactExportQueueMessageSchema = z.object({
  kind: z.literal("contact_export"),
  exportJobId: z.string(),
});
export type ContactExportQueueMessage = z.infer<typeof contactExportQueueMessageSchema>;

export type QueueMessage =
  | CampaignQueueMessage
  | DeliveryQueueMessage
  | ArchiveQueueMessage
  | BroadcastQueueMessage
  | ContactImportQueueMessage
  | ContactExportQueueMessage;

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  apiKeyId?: string;
}

export interface DeliveryEvent {
  id: string;
  workspaceId: string;
  deliveryId: string;
  provider: "cloudflare" | "resend" | "webhook";
  providerMessageId?: string;
  type: DeliveryEventType;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data: T;
  meta?: {
    nextCursor?: string;
    requestId?: string;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
