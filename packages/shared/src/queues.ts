import * as z from "zod";

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
