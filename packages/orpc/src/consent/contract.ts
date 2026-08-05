import { subscriptionTopicRowSchema } from "@openengage/core/consent";
import { oc } from "@orpc/contract";
import * as z from "zod";

import { authedErrors, workspaceErrors } from "../shared/errors";

export const consentContract = {
  listTopics: oc
    .route({ method: "GET", path: "/subscription-topics" })
    .errors(workspaceErrors)
    .output(z.array(subscriptionTopicRowSchema)),
  createTopic: oc
    .route({ method: "POST", path: "/subscription-topics", successStatus: 201 })
    .errors({
      ...authedErrors,
      TOPIC_CONFLICT: { status: 409, message: "同じスラッグのTopicが既に存在します" },
    })
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().max(2_000).default(""),
        isDefault: z.boolean().default(false),
      }),
    )
    .output(z.object({ id: z.string() })),
};
