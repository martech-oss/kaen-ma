import { z } from "zod";

import { workspaceRoleSchema } from "@kaenma/shared";

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
