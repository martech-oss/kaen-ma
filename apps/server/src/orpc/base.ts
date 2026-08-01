import { implement } from "@orpc/server";

import { contract } from "@kaenma/orpc";
import type { WorkspaceRole } from "@kaenma/shared";

import { resolveWorkspaceAccess, WorkspaceAccessError } from "../auth/access";
import { hasWorkspaceRole } from "../auth/authorization";
import type { OrpcInitialContext } from "./context";

export const os = implement(contract).$context<OrpcInitialContext>();

const requireWorkspace = os.middleware(async ({ context, next, errors }) => {
  try {
    const access = await resolveWorkspaceAccess({
      database: context.database,
      env: context.env,
      headers: context.headers,
      method: context.method,
      executionContext: context.executionContext,
    });
    return next({ context: access });
  } catch (error) {
    if (!(error instanceof WorkspaceAccessError)) throw error;
    switch (error.code) {
      case "invalid_api_key":
        throw errors.INVALID_API_KEY();
      case "origin_mismatch":
        throw errors.ORIGIN_MISMATCH();
      case "workspace_required":
        throw errors.WORKSPACE_REQUIRED();
      case "unauthorized":
        throw errors.UNAUTHORIZED();
    }
  }
});

export const authed = os.use(requireWorkspace);

/**
 * Shared role guard for oRPC handlers. Every role-gated contract declares a
 * FORBIDDEN error; pass its constructor so the thrown error stays typed.
 */
export function requireRole(
  role: WorkspaceRole,
  minimum: WorkspaceRole,
  forbidden: () => Error,
): void {
  if (!hasWorkspaceRole(role, minimum)) throw forbidden();
}
