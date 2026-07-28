import { timingSafeEqual } from "@kaenma/channels";
import { resolveMemberContext } from "@kaenma/db";
import type { WorkspaceRole } from "@kaenma/shared";
import { createMiddleware } from "hono/factory";
import { createAuth } from "./auth";
import { sha256Hex } from "./crypto";
import type { AppEnvironment, SessionValue } from "./env";

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 0,
  analyst: 1,
  marketer: 2,
  admin: 3,
  owner: 4,
};

export const requestContext = createMiddleware<AppEnvironment>(async (context, next) => {
  const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("X-Request-Id", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  context.header(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  );
});

export const requireWorkspace = createMiddleware<AppEnvironment>(async (context, next) => {
  const bearer = context.req.header("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const apiContext = await resolveApiKey(context.env.DB, bearer.slice(7));
    if (!apiContext) return apiError(context, 401, "invalid_api_key", "APIキーが無効です");
    context.set("workspace", apiContext);
    context.set("session", null);
    context.executionCtx.waitUntil(
      context.env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), apiContext.apiKeyId)
        .run()
        .then(() => undefined),
    );
    return next();
  }

  const auth = createAuth(context.env);
  const session = (await auth.api.getSession({
    headers: context.req.raw.headers,
  })) as SessionValue | null;
  if (!session) return apiError(context, 401, "unauthorized", "ログインが必要です");

  if (isMutation(context.req.method)) {
    const origin = context.req.header("origin");
    if (origin && origin !== new URL(context.env.APP_URL).origin) {
      return apiError(context, 403, "origin_mismatch", "許可されていないOriginです");
    }
  }

  const requestedOrganizationId =
    context.req.header("x-kaenma-workspace") ??
    session.session.activeOrganizationId ??
    null;
  const workspace = await resolveMemberContext(
    context.env.DB,
    session.user.id,
    requestedOrganizationId,
  );
  if (!workspace) {
    return apiError(
      context,
      403,
      "workspace_required",
      "利用可能なワークスペースがありません",
    );
  }
  context.set("workspace", workspace);
  context.set("session", session);
  await next();
});

export function requireRole(minimum: WorkspaceRole) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const workspace = context.get("workspace");
    if (roleRank[workspace.role] < roleRank[minimum]) {
      return apiError(context, 403, "forbidden", "この操作を行う権限がありません");
    }
    await next();
  });
}

export function apiError(
  context: {
    get(key: "requestId"): string;
    json: (body: unknown, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503) => Response;
  },
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return context.json(
    {
      error: {
        code,
        message,
        requestId: context.get("requestId"),
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
  );
}

async function resolveApiKey(database: D1Database, token: string) {
  const match = token.match(/^kaenma_([A-Za-z0-9]{12})_([A-Za-z0-9-]{20,})$/);
  if (!match) return null;
  const prefix = match[1];
  const row = await database
    .prepare(
      `SELECT id, workspace_id, created_by_user_id, role, key_hash
       FROM api_keys
       WHERE prefix = ? AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       LIMIT 1`,
    )
    .bind(prefix, new Date().toISOString())
    .first<{
      id: string;
      workspace_id: string;
      created_by_user_id: string;
      role: WorkspaceRole;
      key_hash: string;
    }>();
  if (!row) return null;
  const hash = await sha256Hex(token);
  if (!timingSafeEqual(hash, row.key_hash)) return null;
  return {
    workspaceId: row.workspace_id,
    userId: row.created_by_user_id,
    role: row.role,
    apiKeyId: row.id,
  };
}

function isMutation(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}
