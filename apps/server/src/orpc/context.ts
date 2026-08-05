import type { OpenEngageDatabase } from "@openengage/database";
import type { WorkspaceContext } from "@openengage/orpc";

import type { RuntimeEnv, SessionValue } from "../env";

export interface OrpcInitialContext {
  database: OpenEngageDatabase;
  requestId: string;
  env: RuntimeEnv;
  headers: Headers;
  method: string;
  executionContext: {
    waitUntil(promise: Promise<unknown>): void;
  };
}

export interface OrpcContext extends OrpcInitialContext {
  workspace: WorkspaceContext;
  session: SessionValue | null;
}
