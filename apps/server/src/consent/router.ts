import { authed, requireRole } from "../orpc/base";
import { createSubscriptionTopic, listSubscriptionTopics } from "./service";

export const listTopicsProcedure = authed.consent.listTopics.handler(({ context }) =>
  listSubscriptionTopics(context.database, context.workspace.workspaceId),
);

export const createTopicProcedure = authed.consent.createTopic.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const outcome = await createSubscriptionTopic(
      context.database,
      context.workspace.workspaceId,
      input,
    );
    if (outcome.kind === "conflict") throw errors.TOPIC_CONFLICT();
    return { id: outcome.id };
  },
);
