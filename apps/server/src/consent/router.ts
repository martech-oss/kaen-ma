import { authed, requireRole } from "../orpc/base";
import { createSubscriptionTopic, listSubscriptionTopics } from "./service";

export const listTopicsProcedure = authed.consent.listTopics.handler(({ context }) =>
  listSubscriptionTopics(context.database, context.workspace),
);

export const createTopicProcedure = authed.consent.createTopic.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const outcome = await createSubscriptionTopic(context.database, context.workspace, input);
    if (outcome.kind === "conflict") throw errors.TOPIC_CONFLICT();
    return { id: outcome.id };
  },
);

export const consentProcedures = {
  listTopics: listTopicsProcedure,
  createTopic: createTopicProcedure,
};
