import { uuidv7 } from "@kaenma/database";

import { hasWorkspaceRole } from "../auth/authorization";
import { sha256Hex } from "../crypto";
import { randomString } from "../http/helpers";
import { authed } from "../orpc/base";
import { getDashboard } from "./dashboard-service";

export const dashboardProcedure = authed.operations.dashboard.handler(async ({ context }) => {
  return getDashboard(context.database, context.workspace.workspaceId);
});

export const createApiKeyProcedure = authed.operations.createApiKey.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "admin")) throw errors.FORBIDDEN();
    const prefix = randomString(12);
    const token = `kaenma_${prefix}_${randomString(40)}`;
    const id = uuidv7();
    await context.database
      .prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.workspace.workspaceId,
        context.workspace.userId,
        input.name,
        prefix,
        await sha256Hex(token),
        input.role,
        input.expiresAt ?? null,
        new Date().toISOString(),
      )
      .run();
    return { id, token };
  },
);
