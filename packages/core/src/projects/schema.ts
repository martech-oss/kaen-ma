import * as z from "zod";

export const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectRow = z.infer<typeof projectRowSchema>;

export const projectResourceTypeSchema = z.enum(["automation", "email", "form", "page", "segment"]);
