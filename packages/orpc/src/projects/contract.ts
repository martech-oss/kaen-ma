import { oc } from "@orpc/contract";
import * as z from "zod";

import { authedErrors, workspaceErrors } from "../shared/errors";

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

export const projectResourceTypeSchema = z.enum(["campaign", "email", "form", "page", "segment"]);

export const projectsContract = {
  list: oc
    .route({ method: "GET", path: "/projects" })
    .errors(workspaceErrors)
    .output(z.array(projectRowSchema)),
  create: oc
    .route({ method: "POST", path: "/projects", successStatus: 201 })
    .errors(authedErrors)
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        description: z.string().max(2_000).default(""),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#7c3aed"),
      }),
    )
    .output(z.object({ id: z.string() })),
  addItem: oc
    .route({ method: "POST", path: "/projects/{id}/items" })
    .errors({
      ...authedErrors,
      PROJECT_NOT_FOUND: { status: 404, message: "Projectが見つかりません" },
    })
    .input(
      z.object({
        id: z.string().min(1),
        resourceType: projectResourceTypeSchema,
        resourceId: z.string().min(1),
      }),
    )
    .output(z.object({ added: z.boolean() })),
};
