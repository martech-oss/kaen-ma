import type { WorkspaceContext } from "@kaenma/shared";

export interface RuntimeSecrets {
  BETTER_AUTH_SECRET: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  TRACKING_SIGNING_SECRET: string;
  TURNSTILE_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
}

export type RuntimeEnv = CloudflareBindings & RuntimeSecrets;

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
  requestId: string;
  workspace: WorkspaceContext;
  session: SessionValue | null;
}

export type AppEnvironment = {
  Bindings: RuntimeEnv;
  Variables: AppVariables;
};
