import { createWebhookEndpoint, listWebhookEndpoints } from "../integrations/service";
import { authed, requireRole } from "../orpc/base";
import { getWorkspace } from "./service";

export const getWorkspaceProcedure = authed.workspace.get.handler(async ({ context }) =>
  getWorkspace(context.database, context.workspace),
);

export const listWebhookEndpointsProcedure = authed.workspace.listWebhookEndpoints.handler(
  async ({ context, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    return listWebhookEndpoints(context.database, context.workspace.workspaceId);
  },
);

export const createWebhookEndpointProcedure = authed.workspace.createWebhookEndpoint.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const outcome = await createWebhookEndpoint(
      context.database,
      context.env.CREDENTIAL_ENCRYPTION_KEY,
      context.workspace.workspaceId,
      input,
    );
    if (outcome.kind === "unsafe_url") throw errors.UNSAFE_WEBHOOK_URL();
    return { id: outcome.id, signingSecret: outcome.signingSecret };
  },
);
