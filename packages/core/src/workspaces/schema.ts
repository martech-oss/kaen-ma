import * as z from "zod";

import { workspaceRoleSchema } from "../shared/schema";

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  timezone: z.string(),
  created_at: z.number(),
  role: workspaceRoleSchema,
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const webhookEndpointRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  eventTypes: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WebhookEndpointRow = z.infer<typeof webhookEndpointRowSchema>;
