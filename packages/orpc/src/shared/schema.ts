import * as z from "zod";

/**
 * The raw arrays behind each schema below are exported too, so
 * `@kaenma/database`'s schema files can build their matching CHECK
 * constraint from the exact same source (via `checkEnum`) instead of
 * hand-duplicating the value list - the "role" enum alone used to be
 * hand-written in four different places.
 */

export const WORKSPACE_ROLES = ["owner", "admin", "marketer", "analyst", "viewer"] as const;
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const MESSAGE_PURPOSES = ["transactional", "marketing"] as const;
export const messagePurposeSchema = z.enum(MESSAGE_PURPOSES);
export type MessagePurpose = z.infer<typeof messagePurposeSchema>;

export const CHANNELS = ["email", "webhook"] as const;
export const channelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof channelSchema>;

export const PROVIDERS = ["resend", "webhook"] as const;
export const providerSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof providerSchema>;

export const DELIVERY_EVENT_TYPES = [
  "accepted",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "unsubscribed",
  "replied",
  "failed",
] as const;
export const deliveryEventTypeSchema = z.enum(DELIVERY_EVENT_TYPES);
export type DeliveryEventType = z.infer<typeof deliveryEventTypeSchema>;

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
  provider: "resend" | "webhook";
  providerMessageId?: string;
  type: DeliveryEventType;
  occurredAt: string;
  metadata: Record<string, unknown>;
}
