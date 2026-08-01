import { Hono } from "hono";
import * as z from "zod";

import { workspaceRoleSchema } from "@kaenma/shared";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import { getDashboard } from "./dashboard-service";
import { createApiKey, startContactExport, startContactImport } from "./service";

export function registerOperationsRoutes(api: Hono<AppEnvironment>): void {
  api.post("/contacts/import", requireRole("marketer"), async (context) => {
    const contentLength = Number(context.req.header("content-length") ?? 0);
    if (contentLength > 25 * 1024 * 1024) {
      return apiError(context, 422, "csv_too_large", "CSVは25MB以下にしてください");
    }
    const text = await context.req.text();
    if (new TextEncoder().encode(text).byteLength > 25 * 1024 * 1024) {
      return apiError(context, 422, "csv_too_large", "CSVは25MB以下にしてください");
    }
    const outcome = await startContactImport(
      context.get("database"),
      { bucket: context.env.ASSETS_BUCKET, queue: context.env.CAMPAIGN_QUEUE },
      context.get("workspace"),
      text,
    );
    if (outcome.kind === "identifier_missing") {
      return apiError(
        context,
        422,
        "csv_identifier_missing",
        "CSVにはemailまたはexternal_id列が必要です",
      );
    }
    return context.json(
      { data: { jobId: outcome.jobId, rows: outcome.rows, parts: outcome.parts } },
      202,
    );
  });

  api.post("/contacts/export", requireRole("analyst"), async (context) => {
    const { jobId } = await startContactExport(
      context.get("database"),
      context.env.CAMPAIGN_QUEUE,
      context.get("workspace"),
    );
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
    const created = await createApiKey(context.get("database"), context.get("workspace"), {
      name: parsed.data.name,
      role: parsed.data.role,
      ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}),
    });
    return context.json({ data: created }, 201);
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
