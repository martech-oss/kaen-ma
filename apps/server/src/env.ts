import type { KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/orpc";

export interface RuntimeSecrets {
  BETTER_AUTH_SECRET: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  TRACKING_SIGNING_SECRET: string;
  TURNSTILE_SECRET?: string;
  RESEND_SEND_API_KEY?: string;
  RESEND_MANAGEMENT_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
}

export type RuntimeEnv = ServerBindings & RuntimeSecrets;

export interface SessionValue {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
  };
  session: {
    id: string;
    userId: string;
    activeOrganizationId?: string | null;
  };
}

export interface AppVariables {
  database: KaenmaDatabase;
  requestId: string;
  workspace: WorkspaceContext;
  session: SessionValue | null;
}

export type AppEnvironment = {
  Bindings: RuntimeEnv;
  Variables: AppVariables;
};
