import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { authSchema, createDatabase } from "@kaenma/database";
import { betterAuth } from "better-auth/minimal";
import { organization, twoFactor } from "better-auth/plugins";
import {
  adminAc,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import type { RuntimeEnv } from "./env";

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
          subject: `${env.APP_NAME} パスワード再設定`,
          text: `次のURLからパスワードを再設定してください。\n\n${url}`,
          html: `<p>次のリンクからパスワードを再設定してください。</p><p><a href="${escapeHtml(url)}">パスワードを再設定</a></p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await sendAuthEmail(env, {
          to: user.email,
          subject: `${env.APP_NAME} メールアドレス確認`,
          text: `次のURLからメールアドレスを確認してください。\n\n${url}`,
          html: `<p>次のリンクからメールアドレスを確認してください。</p><p><a href="${escapeHtml(url)}">メールアドレスを確認</a></p>`,
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
            subject: `${data.organization.name} への招待`,
            text: `${data.inviter.user.name}さんから招待されました。\n\n${url}`,
            html: `<p>${escapeHtml(data.inviter.user.name)}さんから${escapeHtml(data.organization.name)}へ招待されました。</p><p><a href="${escapeHtml(url)}">招待を確認</a></p>`,
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
  input: { to: string; subject: string; text: string; html: string },
): Promise<void> {
  await env.EMAIL.send({
    from: { email: env.TRANSACTIONAL_FROM_EMAIL, name: env.TRANSACTIONAL_FROM_NAME },
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
