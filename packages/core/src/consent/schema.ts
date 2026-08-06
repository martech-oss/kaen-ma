import * as z from "zod";

export const subscriptionTopicRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SubscriptionTopicRow = z.infer<typeof subscriptionTopicRowSchema>;
