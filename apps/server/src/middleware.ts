import { createMiddleware } from "hono/factory";

import { timingSafeEqual } from "@kaenma/channels";
import { createDatabase, resolveMemberContext, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext, WorkspaceRole } from "@kaenma/shared";

import { createAuth } from "./auth";
import { hasWorkspaceRole } from "./authorization";
import { sha256Hex } from "./crypto";
import type { AppEnvironment, SessionValue } from "./env";

interface BackgroundContext {
  waitUntil(promise: Promise<unknown>): void;
}

type WorkspaceAccessErrorCode =
  | "invalid_api_key"
  | "unauthorized"
  | "origin_mismatch"
  | "workspace_required";

export class WorkspaceAccessError extends Error {
  public constructor(
    public readonly status: 401 | 403,
    public readonly code: WorkspaceAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export interface WorkspaceAccess {
  workspace: WorkspaceContext;
  session: SessionValue | null;
}

export const requestContext = createMiddleware<AppEnvironment>(async (context, next) => {
  const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
  context.set("database", createDatabase(context.env.DB));
  context.set("requestId", requestId);
  await next();
  context.header("X-Request-Id", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!context.res.headers.has("Content-Security-Policy")) {
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
  }
});

export const requireWorkspace = createMiddleware<AppEnvironment>(async (context, next) => {
  try {
    const access = await resolveWorkspaceAccess({
      database: context.get("database"),
      env: context.env,
      headers: context.req.raw.headers,
      method: context.req.method,
      executionContext: context.executionCtx,
    });
    context.set("workspace", access.workspace);
    context.set("session", access.session);
    await next();
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return apiError(context, error.status, error.code, error.message);
    }
    throw error;
  }
});

export async function resolveWorkspaceAccess({
  database,
  env,
  headers,
  method,
  executionContext,
}: {
  database: KaenmaDatabase;
  env: AppEnvironment["Bindings"];
  headers: Headers;
  method: string;
  executionContext: BackgroundContext;
}): Promise<WorkspaceAccess> {
  const bearer = headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const apiContext = await resolveApiKey(database, bearer.slice(7));
    if (!apiContext) {
      throw new WorkspaceAccessError(401, "invalid_api_key", "APIキーが無効です");
    }
    executionContext.waitUntil(
      database
        .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), apiContext.apiKeyId)
        .run()
        .then(() => undefined),
    );
    return { workspace: apiContext, session: null };
  }

  const auth = createAuth(env);
  const session = (await auth.api.getSession({
    headers,
  })) as SessionValue | null;
  if (!session) {
    throw new WorkspaceAccessError(401, "unauthorized", "ログインが必要です");
  }

  if (isMutation(method)) {
    const origin = headers.get("origin");
    if (origin && origin !== new URL(env.APP_URL).origin) {
      throw new WorkspaceAccessError(403, "origin_mismatch", "許可されていないOriginです");
    }
  }

  const requestedOrganizationId =
    headers.get("x-kaenma-workspace") ?? session.session.activeOrganizationId ?? null;
  const workspace = await resolveMemberContext(database, session.user.id, requestedOrganizationId);
  if (!workspace) {
    throw new WorkspaceAccessError(
      403,
      "workspace_required",
      "利用可能なワークスペースがありません",
    );
  }
  return { workspace, session };
}

export function requireRole(minimum: WorkspaceRole) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const workspace = context.get("workspace");
    if (!hasWorkspaceRole(workspace.role, minimum)) {
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

async function resolveApiKey(database: KaenmaDatabase, token: string) {
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
