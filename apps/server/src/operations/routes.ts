import { Hono } from "hono";
import * as z from "zod";

import { uuidv7 } from "@kaenma/database";
import { workspaceRoleSchema } from "@kaenma/shared";

import { sha256Hex } from "../crypto";
import { type AppEnvironment } from "../env";
import { parseCsv, randomString, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import { getDashboard } from "./dashboard-service";

export function registerOperationsRoutes(api: Hono<AppEnvironment>): void {
  api.post("/contacts/import", requireRole("marketer"), async (context) => {
    const database = context.get("database");
    const contentLength = Number(context.req.header("content-length") ?? 0);
    if (contentLength > 25 * 1024 * 1024) {
      return apiError(context, 422, "csv_too_large", "CSVは25MB以下にしてください");
    }
    const text = await context.req.text();
    if (new TextEncoder().encode(text).byteLength > 25 * 1024 * 1024) {
      return apiError(context, 422, "csv_too_large", "CSVは25MB以下にしてください");
    }
    const rows = parseCsv(text);
    const header = rows.shift()?.map((value) => value.trim().toLowerCase());
    if (!header?.includes("email") && !header?.includes("external_id")) {
      return apiError(
        context,
        422,
        "csv_identifier_missing",
        "CSVにはemailまたはexternal_id列が必要です",
      );
    }
    const workspace = context.get("workspace");
    const jobId = uuidv7();
    const baseKey = `${workspace.workspaceId}/imports/${jobId}`;
    const partSize = 100;
    const parts: string[] = [];
    for (let offset = 0; offset < rows.length; offset += partSize) {
      const part = rows.slice(offset, offset + partSize).map((values) => {
        const record: Record<string, string> = {};
        for (const [index, name] of header.entries()) {
          if (name) record[name] = values[index] ?? "";
        }
        return JSON.stringify(record);
      });
      parts.push(part.join("\n"));
    }
    for (let offset = 0; offset < parts.length; offset += 20) {
      await Promise.all(
        parts.slice(offset, offset + 20).map((part, relativeIndex) => {
          const index = offset + relativeIndex;
          return context.env.ASSETS_BUCKET.put(`${baseKey}/part-${index}.ndjson`, part, {
            httpMetadata: { contentType: "application/x-ndjson" },
          });
        }),
      );
    }
    await context.env.ASSETS_BUCKET.put(
      `${baseKey}/manifest.json`,
      JSON.stringify({ header, parts: parts.length, rows: rows.length }),
      { httpMetadata: { contentType: "application/json" } },
    );
    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO import_jobs
       (id, workspace_id, kind, r2_key, status, cursor, created_at, updated_at)
       VALUES (?, ?, 'contact_import', ?, 'pending', ?, ?, ?)`,
      )
      .bind(
        jobId,
        workspace.workspaceId,
        baseKey,
        JSON.stringify({ totalParts: parts.length }),
        now,
        now,
      )
      .run();
    if (parts.length > 0) {
      await context.env.CAMPAIGN_QUEUE.send({
        kind: "contact_import",
        importJobId: jobId,
        part: 0,
        totalParts: parts.length,
      });
    } else {
      await database
        .prepare("UPDATE import_jobs SET status = 'completed', updated_at = ? WHERE id = ?")
        .bind(now, jobId)
        .run();
    }
    return context.json({ data: { jobId, rows: rows.length, parts: parts.length } }, 202);
  });

  api.post("/contacts/export", requireRole("analyst"), async (context) => {
    const workspace = context.get("workspace");
    const jobId = uuidv7();
    const key = `${workspace.workspaceId}/exports/contacts-${jobId}.csv`;
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO import_jobs
       (id, workspace_id, kind, r2_key, status, cursor, created_at, updated_at)
       VALUES (?, ?, 'contact_export', ?, 'pending', ?, ?, ?)`,
      )
      .bind(
        jobId,
        workspace.workspaceId,
        key,
        JSON.stringify({
          partNumber: 0,
          lastId: "",
        }),
        now,
        now,
      )
      .run();
    await context.env.CAMPAIGN_QUEUE.send({ kind: "contact_export", exportJobId: jobId });
    return context.json({ data: { jobId } }, 202);
  });

  api.get("/data-jobs/:id", requireRole("analyst"), async (context) => {
    const row = await context
      .get("database")
      .prepare(
        `SELECT id, kind, status, processed, succeeded, failed, r2_key,
              error_manifest_key, created_at, updated_at
       FROM import_jobs WHERE workspace_id = ? AND id = ?`,
      )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first();
    return row
      ? context.json({ data: row })
      : apiError(context, 404, "data_job_not_found", "データJobが見つかりません");
  });

  api.get("/data-jobs/:id/download", requireRole("analyst"), async (context) => {
    const row = await context
      .get("database")
      .prepare(
        `SELECT r2_key, status FROM import_jobs
       WHERE workspace_id = ? AND id = ? AND kind = 'contact_export'`,
      )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first<{ r2_key: string; status: string }>();
    if (!row || row.status !== "completed") {
      return apiError(context, 404, "export_not_ready", "Exportはまだ完了していません");
    }
    const object = await context.env.ASSETS_BUCKET.get(row.r2_key);
    if (!object) return apiError(context, 404, "export_missing", "Exportファイルがありません");
    return new Response(object.body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kaenma-contacts-${context.req.param("id")}.csv"`,
      },
    });
  });

  api.get("/dashboard", async (context) => {
    const data = await getDashboard(context.get("database"), context.get("workspace").workspaceId);
    return context.json({ data });
  });

  api.post("/api-keys", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        role: workspaceRoleSchema.default("viewer"),
        expiresAt: z.iso.datetime().optional(),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const actor = context.get("workspace");
    const prefix = randomString(12);
    const secret = randomString(40);
    const token = `kaenma_${prefix}_${secret}`;
    const id = uuidv7();
    await context
      .get("database")
      .prepare(
        `INSERT INTO api_keys
       (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        actor.workspaceId,
        actor.userId,
        parsed.data.name,
        prefix,
        await sha256Hex(token),
        parsed.data.role,
        parsed.data.expiresAt ?? null,
        new Date().toISOString(),
      )
      .run();
    return context.json({ data: { id, token, prefix } }, 201);
  });

  api.get("/dead-letters", requireRole("admin"), async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, source_queue, error, attempts, status, created_at, replayed_at
       FROM dead_letters WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/dead-letters/:id/replay", requireRole("admin"), async (context) => {
    const database = context.get("database");
    const row = await database
      .prepare(
        `SELECT id, source_queue, message_body FROM dead_letters
       WHERE workspace_id = ? AND id = ? AND status = 'pending'`,
      )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first<{ id: string; source_queue: string; message_body: string }>();
    if (!row) return apiError(context, 404, "dead_letter_not_found", "DLQ項目が見つかりません");
    const body: unknown = JSON.parse(row.message_body);
    if (row.source_queue === "kaenma-campaign") {
      await context.env.CAMPAIGN_QUEUE.send(body);
    } else {
      await context.env.DELIVERY_QUEUE.send(body);
    }
    await database
      .prepare(
        "UPDATE dead_letters SET status = 'replayed', replayed_at = ? WHERE id = ? AND status = 'pending'",
      )
      .bind(new Date().toISOString(), row.id)
      .run();
    return context.json({ data: { replayed: true } });
  });
}
