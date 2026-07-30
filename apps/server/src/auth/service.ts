import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { organization, twoFactor } from "better-auth/plugins";
import { adminAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";

import { PermanentChannelError, ResendEmailAdapter } from "@kaenma/channels";
import { authSchema, createDatabase } from "@kaenma/database";

import type { RuntimeEnv } from "../env";

export function createAuth(env: RuntimeEnv, requestOrigin?: string) {
  const database = createDatabase(env.DB).orm;
  const baseURL = resolveAuthBaseURL(env, requestOrigin);
  const requireEmailVerification = isEmailVerificationRequired(env.ENVIRONMENT);
  return betterAuth({
    appName: env.APP_NAME,
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: authSchema,
      usePlural: false,
    }),
    trustedOrigins: [...new Set([env.APP_URL, baseURL])],
    advanced: {
      useSecureCookies: env.ENVIRONMENT !== "development",
      cookiePrefix: "kaenma",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.ENVIRONMENT !== "development",
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      minPasswordLength: 12,
      async sendResetPassword({ user, url }) {
        await sendAuthEmail(env, {
          to: user.email,
          templateId: env.RESEND_TEMPLATE_PASSWORD_RESET,
          variables: { APP_NAME: env.APP_NAME, ACTION_URL: url },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await sendAuthEmail(env, {
          to: user.email,
          templateId: env.RESEND_TEMPLATE_EMAIL_VERIFICATION,
          variables: { APP_NAME: env.APP_NAME, ACTION_URL: url },
        });
      },
    },
    plugins: [
      twoFactor({
        issuer: env.APP_NAME,
      }),
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: 25,
        creatorRole: "owner",
        roles: {
          owner: ownerAc,
          admin: adminAc,
          marketer: memberAc,
          analyst: memberAc,
          viewer: memberAc,
        },
        requireEmailVerificationOnInvitation: true,
        async sendInvitationEmail(data) {
          const url = `${baseURL}/accept-invitation?id=${encodeURIComponent(data.id)}`;
          await sendAuthEmail(env, {
            to: data.email,
            templateId: env.RESEND_TEMPLATE_ORGANIZATION_INVITATION,
            variables: {
              APP_NAME: env.APP_NAME,
              ACTION_URL: url,
              INVITER_NAME: data.inviter.user.name,
              ORGANIZATION_NAME: data.organization.name,
            },
          });
        },
      }),
    ],
    rateLimit: {
      enabled: env.ENVIRONMENT !== "development",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 300, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
  });
}

export function isEmailVerificationRequired(environment: string): boolean {
  return environment !== "development";
}

export function resolveAuthBaseURL(
  env: Pick<RuntimeEnv, "APP_URL" | "ENVIRONMENT">,
  requestOrigin?: string,
): string {
  if (env.ENVIRONMENT !== "development" || !requestOrigin) return env.APP_URL;
  try {
    const origin = new URL(requestOrigin);
    const hostname = origin.hostname.toLowerCase();
    if (
      origin.protocol === "http:" &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")
    ) {
      return origin.origin;
    }
  } catch {
    // Fall back to the configured URL when the request origin is malformed.
  }
  return env.APP_URL;
}

async function sendAuthEmail(
  env: RuntimeEnv,
  input: {
    to: string;
    templateId: string;
    variables: Record<string, string | number>;
  },
): Promise<void> {
  if (!env.RESEND_SEND_API_KEY) {
    throw new PermanentChannelError("RESEND_SEND_API_KEY is not configured");
  }
  const adapter = new ResendEmailAdapter({ apiKey: env.RESEND_SEND_API_KEY });
  await adapter.send({
    kind: "email",
    idempotencyKey: `auth:${input.templateId}:${await authEmailKey(input.to, input.variables)}`,
    purpose: "transactional",
    to: input.to,
    from: {
      email: env.TRANSACTIONAL_FROM_EMAIL,
      name: env.TRANSACTIONAL_FROM_NAME,
    },
    template: {
      id: input.templateId,
      variables: input.variables,
    },
  });
}

async function authEmailKey(
  recipient: string,
  variables: Record<string, string | number>,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([recipient, variables])),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
