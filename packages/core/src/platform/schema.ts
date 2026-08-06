import * as z from "zod";

export const deadLetterRowSchema = z.object({
  id: z.string(),
  sourceQueue: z.string(),
  error: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  status: z.enum(["pending", "replayed", "discarded"]),
  createdAt: z.string(),
  replayedAt: z.string().nullable(),
});
export type DeadLetterRow = z.infer<typeof deadLetterRowSchema>;
