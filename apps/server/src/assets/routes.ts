import { Hono } from "hono";

import { uuidv7 } from "@kaenma/database";

import { type AppEnvironment } from "../env";
import { sanitizeFilename, sha256HexFromBytes } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

export function registerAssetRoutes(api: Hono<AppEnvironment>): void {
  api.post("/assets", requireRole("marketer"), async (context) => {
    const contentLength = Number(context.req.header("content-length") ?? 0);
    if (contentLength > 25 * 1024 * 1024) {
      return apiError(context, 422, "asset_too_large", "Assetは25MB以下にしてください");
    }
    const name = context.req.query("name")?.slice(0, 191);
    if (!name) return apiError(context, 422, "name_required", "nameが必要です");
    const workspace = context.get("workspace");
    const id = uuidv7();
    const key = `${workspace.workspaceId}/assets/${id}/${sanitizeFilename(name)}`;
    const body = await context.req.arrayBuffer();
    const checksum = await sha256HexFromBytes(body);
    const contentType = context.req.header("content-type") ?? "application/octet-stream";
    await context.env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { workspaceId: workspace.workspaceId, assetId: id },
      sha256: checksum,
    });
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO assets
       (id, workspace_id, name, r2_key, content_type, size, checksum, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, workspace.workspaceId, name, key, contentType, body.byteLength, checksum, now, now)
      .run();
    return context.json({ data: { id, name, contentType, size: body.byteLength } }, 201);
  });

  api.get("/assets/:id", async (context) => {
    const workspace = context.get("workspace");
    const row = await context
      .get("database")
      .prepare("SELECT r2_key, content_type, name FROM assets WHERE workspace_id = ? AND id = ?")
      .bind(workspace.workspaceId, context.req.param("id"))
      .first<{ r2_key: string; content_type: string; name: string }>();
    if (!row) return apiError(context, 404, "asset_not_found", "Assetが見つかりません");
    const object = await context.env.ASSETS_BUCKET.get(row.r2_key);
    if (!object)
      return apiError(context, 404, "asset_object_missing", "R2オブジェクトがありません");
    return new Response(object.body, {
      headers: {
        "Content-Type": row.content_type,
        "Content-Disposition": `inline; filename="${sanitizeFilename(row.name)}"`,
        ETag: object.httpEtag,
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}
