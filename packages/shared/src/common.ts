import * as z from "zod";

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
