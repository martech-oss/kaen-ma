import { workspaceSchema } from "@openengage/core/workspaces";
import { oc } from "@orpc/contract";
import * as z from "zod";

import { authedErrors, workspaceErrors } from "../shared/errors";

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

export const workspaceContract = {
  get: oc
    .route({ method: "GET", path: "/workspace" })
    .errors(workspaceErrors)
    .output(workspaceSchema),
  listWebhookEndpoints: oc
    .route({ method: "GET", path: "/webhook-endpoints" })
    .errors(authedErrors)
    .output(z.array(webhookEndpointRowSchema)),
  createWebhookEndpoint: oc
    .route({ method: "POST", path: "/webhook-endpoints", successStatus: 201 })
    .errors({
      ...authedErrors,
      UNSAFE_WEBHOOK_URL: {
        status: 422,
        message: "Webhook URLには公開HTTPSエンドポイントを指定してください",
      },
    })
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        url: z.url().startsWith("https://"),
        eventTypes: z.array(z.string().max(120)).max(100).default([]),
      }),
    )
    // The signing secret is shown once and stored encrypted.
    .output(z.object({ id: z.string(), signingSecret: z.string() })),
};
