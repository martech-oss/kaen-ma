import { Hono } from "hono";
import * as z from "zod";

import { uuidv7, type KaenmaDatabase } from "@kaenma/database";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

const messageVariableInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/, "keyは英小文字で始まり、英小文字・数字・_のみ使用できます"),
  name: z.string().trim().min(1).max(191),
  value: z.string().max(20_000),
  description: z.string().max(2_000).default(""),
});

export function registerMessageVariableRoutes(api: Hono<AppEnvironment>): void {
  api.get("/message-variables", async (context) => {
    const archived = context.req.query("archived") === "true";
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, key, name, value, description, archived_at, created_at, updated_at
       FROM message_variables
       WHERE workspace_id = ?
         AND archived_at IS ${archived ? "NOT NULL" : "NULL"}
       ORDER BY updated_at DESC`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/message-variables", requireRole("marketer"), async (context) => {
    const parsed = messageVariableInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const now = new Date().toISOString();
    try {
      const id = uuidv7();
      await context
        .get("database")
        .prepare(
          `INSERT INTO message_variables
         (id, workspace_id, key, name, value, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          context.get("workspace").workspaceId,
          parsed.data.key,
          parsed.data.name,
          parsed.data.value,
          parsed.data.description,
          now,
          now,
        )
        .run();
      return context.json({ data: { id } }, 201);
    } catch (error) {
      return apiError(
        context,
        409,
        "message_variable_key_exists",
        "同じキーのメッセージ変数が既にあります",
        error instanceof Error ? error.message : undefined,
      );
    }
  });

  api.patch("/message-variables/:id", requireRole("marketer"), async (context) => {
    const parsed = messageVariableInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    try {
      const result = await context
        .get("database")
        .prepare(
          `UPDATE message_variables
           SET key = ?, name = ?, value = ?, description = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
        )
        .bind(
          parsed.data.key,
          parsed.data.name,
          parsed.data.value,
          parsed.data.description,
          new Date().toISOString(),
          context.get("workspace").workspaceId,
          context.req.param("id"),
        )
        .run();
      return result.meta.changes === 1
        ? context.json({ data: { updated: true } })
        : apiError(context, 404, "message_variable_not_found", "メッセージ変数が見つかりません");
    } catch (error) {
      return apiError(
        context,
        409,
        "message_variable_key_exists",
        "同じキーのメッセージ変数が既にあります",
        error instanceof Error ? error.message : undefined,
      );
    }
  });

  api.post("/message-variables/:id/archive", requireRole("marketer"), async (context) => {
    const now = new Date().toISOString();
    const result = await context
      .get("database")
      .prepare(
        `UPDATE message_variables SET archived_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(now, now, context.get("workspace").workspaceId, context.req.param("id"))
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "message_variable_not_found", "メッセージ変数が見つかりません");
  });
}

export async function readMessageVariableValues(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const result = await database
    .prepare(
      `SELECT key, value FROM message_variables
       WHERE workspace_id = ? AND archived_at IS NULL`,
    )
    .bind(workspaceId)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(result.results.map((variable) => [variable.key, variable.value]));
}
