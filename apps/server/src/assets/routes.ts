import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { assets, uuidv7 } from "@kaenma/database";

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
    await context.get("database").orm.insert(assets).values({
      id,
      workspaceId: workspace.workspaceId,
      name,
      r2Key: key,
      contentType,
      size: body.byteLength,
      checksum,
      createdAt: now,
      updatedAt: now,
    });
    return context.json({ data: { id, name, contentType, size: body.byteLength } }, 201);
  });

  api.get("/assets/:id", async (context) => {
    const workspace = context.get("workspace");
    const row = await context.get("database").orm.query.assets.findFirst({
      columns: { r2Key: true, contentType: true, name: true },
      where: and(
        eq(assets.workspaceId, workspace.workspaceId),
        eq(assets.id, context.req.param("id")),
      ),
    });
    if (!row) return apiError(context, 404, "asset_not_found", "Assetが見つかりません");
    const object = await context.env.ASSETS_BUCKET.get(row.r2Key);
    if (!object)
      return apiError(context, 404, "asset_object_missing", "R2オブジェクトがありません");
    return new Response(object.body, {
      headers: {
        "Content-Type": row.contentType,
        "Content-Disposition": `inline; filename="${sanitizeFilename(row.name)}"`,
        ETag: object.httpEtag,
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}
