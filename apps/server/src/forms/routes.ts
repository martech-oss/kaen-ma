import { Hono } from "hono";
import { z } from "zod";

import { uuidv7 } from "@kaenma/database";

import { type AppEnvironment } from "../env";
import { parseJsonColumns, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import { isValidDomain, normalizeDomain } from "../public/routes";

export function registerFormRoutes(api: Hono<AppEnvironment>): void {
  const allowedDomainsSchema = z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(253)
        .transform(normalizeDomain)
        .refine(isValidDomain, "有効なドメインを入力してください"),
    )
    .max(50);

  api.get("/forms", async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `SELECT f.id, f.name, f.slug, f.status, f.version, f.definition,
              f.allowed_domains, f.turnstile_enabled, f.success_message,
              f.created_at, f.updated_at,
              (SELECT COUNT(*) FROM form_submissions fs
               WHERE fs.workspace_id = f.workspace_id AND fs.form_id = f.id)
                AS submission_count
       FROM forms f
       WHERE f.workspace_id = ? AND f.status != 'archived'
       ORDER BY f.updated_at DESC LIMIT 200`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({
      data: result.results.map(parseJsonColumns(["definition", "allowed_domains"])),
    });
  });

  api.post("/forms", requireRole("marketer"), async (context) => {
    const schema = z.object({
      name: z.string().trim().min(1).max(191),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      status: z.enum(["draft", "published"]).default("draft"),
      definition: z.record(z.string(), z.unknown()),
      allowedDomains: allowedDomainsSchema.default([]),
      turnstileEnabled: z.boolean().default(true),
      successMessage: z.string().max(500).default("ありがとうございます。"),
    });
    const parsed = schema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const id = uuidv7();
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO forms
       (id, workspace_id, name, slug, status, definition, allowed_domains,
        turnstile_enabled, success_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.slug,
        parsed.data.status,
        JSON.stringify(parsed.data.definition),
        JSON.stringify(parsed.data.allowedDomains),
        parsed.data.turnstileEnabled ? 1 : 0,
        parsed.data.successMessage,
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.patch("/forms/:id", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        status: z.enum(["draft", "published"]),
        definition: z.record(z.string(), z.unknown()),
        allowedDomains: allowedDomainsSchema.default([]),
        turnstileEnabled: z.boolean().default(true),
        successMessage: z.string().max(500).default("ありがとうございます。"),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await context
      .get("database")
      .prepare(
        `UPDATE forms
       SET name = ?, slug = ?, status = ?, version = version + 1,
           definition = ?, allowed_domains = ?, turnstile_enabled = ?,
           success_message = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(
        parsed.data.name,
        parsed.data.slug,
        parsed.data.status,
        JSON.stringify(parsed.data.definition),
        JSON.stringify(parsed.data.allowedDomains),
        parsed.data.turnstileEnabled ? 1 : 0,
        parsed.data.successMessage,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { id: context.req.param("id") } })
      : apiError(context, 404, "form_not_found", "フォームが見つかりません");
  });

  api.post("/forms/:id/archive", requireRole("admin"), async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `UPDATE forms SET status = 'archived', updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(new Date().toISOString(), context.get("workspace").workspaceId, context.req.param("id"))
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "form_not_found", "フォームが見つかりません");
  });
}
