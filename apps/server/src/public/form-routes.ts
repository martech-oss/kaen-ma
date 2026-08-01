import type { Hono } from "hono";
import * as z from "zod";

import { uuidv7 } from "@kaenma/database";

import { apiError } from "../auth/access";
import { recordContactEvent } from "../contacts/event-service";
import type { AppEnvironment } from "../env";
import { isRecord, primitiveString, stringOrNull } from "../platform/values";
import { originAllowed, redactFormPayload } from "./domain";
import { safeJson } from "./http";
import { hashIp, verifyTurnstile } from "./shared";
import { formEmbedScript, renderPublicForm } from "./templates";

export function registerPublicFormRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/api/public/forms/:workspaceSlug/:formSlug/embed.js", async (context) => {
    const form = await context
      .get("database")
      .prepare(
        `SELECT f.name, f.definition
         FROM forms f JOIN organization o ON o.id = f.workspace_id
         WHERE o.slug = ? AND f.slug = ? AND f.status = 'published'`,
      )
      .bind(context.req.param("workspaceSlug"), context.req.param("formSlug"))
      .first<{ name: string; definition: string }>();
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    let style = "inline";
    try {
      const definition = JSON.parse(form.definition) as unknown;
      if (
        isRecord(definition) &&
        ["inline", "floating-bar", "floating-box", "modal"].includes(String(definition["style"]))
      ) {
        style = String(definition["style"]);
      }
    } catch {
      // Use the inline fallback for old definitions.
    }
    const formUrl = new URL(
      `/f/${context.req.param("workspaceSlug")}/${context.req.param("formSlug")}`,
      context.req.url,
    ).toString();
    return new Response(formEmbedScript(formUrl, form.name, style), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });

  publicApp.get("/f/:workspaceSlug/:formSlug", async (context) => {
    const form = await context
      .get("database")
      .prepare(
        `SELECT f.name, f.definition, f.allowed_domains
       FROM forms f JOIN organization o ON o.id = f.workspace_id
       WHERE o.slug = ? AND f.slug = ? AND f.status = 'published'`,
      )
      .bind(context.req.param("workspaceSlug"), context.req.param("formSlug"))
      .first<{ name: string; definition: string; allowed_domains: string }>();
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    let definition: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(form.definition) as unknown;
      if (isRecord(parsed)) definition = parsed;
    } catch {
      // Render the required email field when an old definition cannot be parsed.
    }
    const domains = JSON.parse(form.allowed_domains) as string[];
    const frameAncestors =
      domains.length > 0
        ? domains.flatMap((domain) => [
            `https://${domain}`,
            `https://*.${domain}`,
            `http://${domain}`,
            `http://*.${domain}`,
          ])
        : ["https:", "http:"];
    context.header(
      "Content-Security-Policy",
      `default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' ${frameAncestors.join(" ")}`,
    );
    return context.html(renderPublicForm(form.name, definition, context.req.url));
  });

  publicApp.post("/f/:workspaceSlug/:formSlug", async (context) => {
    const database = context.get("database");
    const form = await database
      .prepare(
        `SELECT f.id, f.workspace_id, f.allowed_domains, f.turnstile_enabled, f.success_message
       FROM forms f JOIN organization o ON o.id = f.workspace_id
       WHERE o.slug = ? AND f.slug = ? AND f.status = 'published'`,
      )
      .bind(context.req.param("workspaceSlug"), context.req.param("formSlug"))
      .first<{
        id: string;
        workspace_id: string;
        allowed_domains: string;
        turnstile_enabled: number;
        success_message: string;
      }>();
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    const allowedDomains = JSON.parse(form.allowed_domains) as string[];
    const origin = context.req.header("origin");
    const requestHostname = new URL(context.req.url).hostname;
    if (
      origin &&
      new URL(origin).hostname !== requestHostname &&
      allowedDomains.length > 0 &&
      !originAllowed(origin, allowedDomains)
    ) {
      return apiError(context, 403, "form_origin_denied", "このドメインからは送信できません");
    }
    const body = await safeJson(context);
    if (!isRecord(body)) return apiError(context, 422, "invalid_payload", "入力が不正です");
    if (body["_website"]) return context.json({ data: { accepted: true } }, 202);
    if (
      form.turnstile_enabled === 1 &&
      context.env.TURNSTILE_SECRET &&
      !(await verifyTurnstile(
        context.env.TURNSTILE_SECRET,
        primitiveString(body["turnstileToken"]),
        context.req.header("cf-connecting-ip"),
      ))
    ) {
      return apiError(context, 422, "turnstile_failed", "Turnstile検証に失敗しました");
    }
    const idempotencyKey =
      context.req.header("idempotency-key") ?? primitiveString(body["idempotencyKey"]);
    if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
      return apiError(context, 422, "idempotency_key_required", "Idempotency-Keyが必要です");
    }
    const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : null;
    const now = new Date().toISOString();
    let contactId: string | null = null;
    let contactCreated = false;
    if (email && z.email().safeParse(email).success) {
      const existing = await database
        .prepare("SELECT id FROM contacts WHERE workspace_id = ? AND email = ?")
        .bind(form.workspace_id, email)
        .first<{ id: string }>();
      contactId = existing?.id ?? uuidv7();
      if (existing) {
        await database
          .prepare(
            `UPDATE contacts SET first_name = COALESCE(?, first_name),
           last_name = COALESCE(?, last_name), phone = COALESCE(?, phone),
           updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
          )
          .bind(
            stringOrNull(body["firstName"]),
            stringOrNull(body["lastName"]),
            stringOrNull(body["phone"]),
            now,
            form.workspace_id,
            contactId,
          )
          .run();
      } else {
        contactCreated = true;
        await database
          .prepare(
            `INSERT INTO contacts
           (id, workspace_id, email, first_name, last_name, phone, stage, score,
            status, custom_fields, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'lead', 0, 'active', '{}', ?, ?)`,
          )
          .bind(
            contactId,
            form.workspace_id,
            email,
            stringOrNull(body["firstName"]),
            stringOrNull(body["lastName"]),
            stringOrNull(body["phone"]),
            now,
            now,
          )
          .run();
      }
    }
    if (contactCreated && contactId) {
      await recordContactEvent(database, {
        workspaceId: form.workspace_id,
        contactId,
        type: "contact_created",
        resourceType: "contact",
        resourceId: contactId,
        occurredAt: now,
      });
    }
    try {
      await database
        .prepare(
          `INSERT INTO form_submissions
           (id, workspace_id, form_id, contact_id, idempotency_key, payload, ip_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          uuidv7(),
          form.workspace_id,
          form.id,
          contactId,
          idempotencyKey,
          JSON.stringify(redactFormPayload(body)),
          await hashIp(context.req.header("cf-connecting-ip")),
          now,
        )
        .run();
    } catch {
      return context.json({ data: { accepted: true, duplicate: true } }, 202);
    }
    await recordContactEvent(database, {
      workspaceId: form.workspace_id,
      contactId,
      type: "form_submitted",
      resourceType: "form",
      resourceId: form.id,
      properties: { formId: form.id },
      occurredAt: now,
    });
    return context.json({ data: { accepted: true, message: form.success_message } }, 202);
  });
}
