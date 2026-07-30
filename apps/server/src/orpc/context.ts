import type { KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/shared";

import type { RuntimeEnv, SessionValue } from "../env";

export interface OrpcInitialContext {
  database: KaenmaDatabase;
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
