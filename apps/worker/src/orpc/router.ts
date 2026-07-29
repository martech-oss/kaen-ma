import { contract } from "@kaenma/api-contract";
import {
  writeAuditLog,
  type KaenmaDatabase,
} from "@kaenma/db";
import type { WorkspaceContext } from "@kaenma/shared";
import { implement } from "@orpc/server";
import { hasWorkspaceRole } from "../authorization";
import type { RuntimeEnv, SessionValue } from "../env";
import {
  resolveWorkspaceAccess,
  WorkspaceAccessError,
} from "../middleware";
import {
  createContact,
  listContacts,
} from "../services/contact-service";
import { getWorkspace } from "../services/workspace-service";

export interface OrpcInitialContext {
  database: KaenmaDatabase;
  requestId: string;
  env: RuntimeEnv;
  headers: Headers;
  method: string;
  executionContext: {
    waitUntil(promise: Promise<unknown>): void;
  };
  adminApiFetch(request: Request): Promise<Response>;
}

export interface OrpcContext extends OrpcInitialContext {
  workspace: WorkspaceContext;
  session: SessionValue | null;
}

const os = implement(contract).$context<OrpcInitialContext>();

const requireWorkspace = os.middleware(
  async ({ context, next, errors }) => {
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
  },
);

const authed = os.use(requireWorkspace);

const adminRequestProcedure = os.admin.request.handler(
  async ({ context, input }) => {
    const headers = new Headers();
    for (const name of [
      "authorization",
      "cf-ray",
      "cookie",
      "origin",
      "x-kaenma-workspace",
    ]) {
      const value = context.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (input.body !== undefined) {
      headers.set("content-type", "application/json");
    }

    const response = await context.adminApiFetch(
      new Request(new URL(input.path, "http://kaenma.internal"), {
        method: input.method,
        headers,
        ...(input.body === undefined ? {} : { body: input.body }),
      }),
    );
    const payload = await response.json().catch(() => null);
    return {
      status: response.status,
      payload,
    };
  },
);

const getWorkspaceProcedure = authed.workspace.get.handler(
  async ({ context }) =>
    getWorkspace(context.database, context.workspace),
);

const listContactsProcedure = authed.contacts.list.handler(
  async ({ context, input }) =>
    listContacts(context.database, context.workspace, input),
);

const createContactProcedure = authed.contacts.create.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) {
      throw errors.FORBIDDEN();
    }

    try {
      const contact = await createContact(
        context.database,
        context.workspace,
        input,
      );
      context.executionContext.waitUntil(
        writeAuditLog(context.database, context.workspace, {
          action: "contact.create",
          resourceType: "contact",
          resourceId: contact.id,
        }),
      );
      return contact;
    } catch (error) {
      throw errors.CONTACT_CONFLICT({ cause: error });
    }
  },
);

export const orpcRouter = os.router({
  admin: {
    request: adminRequestProcedure,
  },
  workspace: {
    get: getWorkspaceProcedure,
  },
  contacts: {
    list: listContactsProcedure,
    create: createContactProcedure,
  },
});
