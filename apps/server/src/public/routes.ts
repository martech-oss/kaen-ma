import { Hono } from "hono";
import { z } from "zod";

import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import { renderContent } from "@kaenma/email-renderer";
import { contentDocumentSchema } from "@kaenma/shared";

import { sha256Hex, verifySignedToken } from "../crypto";
import { type AppEnvironment } from "../env";
import { safeJson } from "../http/helpers";
import { apiError } from "../middleware";
import { primitiveString } from "../values";

export function registerPublicRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/p/:workspaceSlug/:pageSlug", async (context) => {
    const page = await context
      .get("database")
      .prepare(
        `SELECT lpv.content_document, o.name AS workspace_name
       FROM landing_pages lp
       JOIN organization o ON o.id = lp.workspace_id
       JOIN landing_page_versions lpv
         ON lpv.id = lp.current_version_id AND lpv.workspace_id = lp.workspace_id
       WHERE o.slug = ? AND lp.slug = ? AND lp.status = 'published'`,
      )
      .bind(context.req.param("workspaceSlug"), context.req.param("pageSlug"))
      .first<{ content_document: string; workspace_name: string }>();
    if (!page) return apiError(context, 404, "page_not_found", "ページが見つかりません");
    const document = contentDocumentSchema.safeParse(JSON.parse(page.content_document));
    if (!document.success) {
      return apiError(context, 500, "page_render_failed", "ページ定義が不正です");
    }
    const rendered = renderContent(document.data, {
      contact: {},
      workspace: { name: page.workspace_name },
    });
    return context.html(rendered.html);
  });

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
    const form = await context
      .get("database")
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
    if (email && z.email().safeParse(email).success) {
      const existing = await context
        .get("database")
        .prepare("SELECT id FROM contacts WHERE workspace_id = ? AND email = ?")
        .bind(form.workspace_id, email)
        .first<{ id: string }>();
      contactId = existing?.id ?? uuidv7();
      if (existing) {
        await context
          .get("database")
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
        await context
          .get("database")
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
    try {
      await context.get("database").batch([
        context
          .get("database")
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
          ),
        context
          .get("database")
          .prepare(
            `INSERT INTO contact_events
           (id, workspace_id, contact_id, type, resource_type, resource_id,
            properties, occurred_at, created_at)
           VALUES (?, ?, ?, 'form_submitted', 'form', ?, ?, ?, ?)`,
          )
          .bind(
            uuidv7(),
            form.workspace_id,
            contactId,
            form.id,
            JSON.stringify({ formId: form.id }),
            now,
            now,
          ),
      ]);
    } catch {
      return context.json({ data: { accepted: true, duplicate: true } }, 202);
    }
    return context.json({ data: { accepted: true, message: form.success_message } }, 202);
  });

  publicApp.get("/api/public/site-tracking/:workspaceSlug/script.js", async (context) => {
    const trackingEndpoint = new URL(
      `/api/public/track/${context.req.param("workspaceSlug")}`,
      context.req.url,
    ).toString();
    const messagesEndpoint = new URL(
      `/api/public/site-messages/${context.req.param("workspaceSlug")}`,
      context.req.url,
    ).toString();
    return new Response(siteTrackingScript(trackingEndpoint, messagesEndpoint), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });

  publicApp.post("/api/public/track/:workspaceSlug", async (context) => {
    const workspace = await loadPublicTrackingWorkspace(
      context.get("database"),
      context.req.param("workspaceSlug"),
    );
    if (!workspace) {
      return context.json({ data: { accepted: false, identityIssued: false } }, 202);
    }
    const origin = context.req.header("origin");
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return apiError(context, 403, "tracking_origin_denied", "このドメインは許可されていません");
    }
    const parsed = z
      .object({
        consent: z.literal(true),
        visitorId: z.string().uuid().optional(),
        email: z.email().optional(),
        type: z.enum(["page_viewed", "custom_event"]),
        resourceId: z.string().max(2_000).optional(),
        properties: z.record(z.string(), z.unknown()).default({}),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) {
      return context.json({ data: { accepted: false, identityIssued: false } }, 202);
    }
    const visitorId = parsed.data.visitorId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const contact = parsed.data.email
      ? await context
          .get("database")
          .prepare(
            `SELECT id FROM contacts
           WHERE workspace_id = ? AND email = ? AND status != 'archived'`,
          )
          .bind(workspace.id, parsed.data.email.toLowerCase())
          .first<{ id: string }>()
      : null;
    await context
      .get("database")
      .prepare(
        `INSERT INTO contact_events
       (id, workspace_id, contact_id, visitor_id, type, resource_type,
        resource_id, properties, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'page', ?, ?, ?, ?)`,
      )
      .bind(
        uuidv7(),
        workspace.id,
        contact?.id ?? null,
        visitorId,
        parsed.data.type,
        parsed.data.resourceId ?? null,
        JSON.stringify(parsed.data.properties),
        now,
        now,
      )
      .run();
    return context.json(
      {
        data: {
          accepted: true,
          visitorId,
          identified: Boolean(contact),
          identityIssued: true,
        },
      },
      202,
    );
  });

  publicApp.get("/api/public/site-messages/:workspaceSlug", async (context) => {
    const workspace = await loadPublicTrackingWorkspace(
      context.get("database"),
      context.req.param("workspaceSlug"),
    );
    const visitorId = context.req.query("visitorId");
    const pageUrl = context.req.query("url") ?? "";
    if (!workspace || !visitorId || !z.string().uuid().safeParse(visitorId).success) {
      return context.json({ data: [] });
    }
    const origin = context.req.header("origin");
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return context.json({ data: [] });
    }
    const identity = await context
      .get("database")
      .prepare(
        `SELECT contact_id FROM contact_events
       WHERE workspace_id = ? AND visitor_id = ? AND contact_id IS NOT NULL
       ORDER BY occurred_at DESC LIMIT 1`,
      )
      .bind(workspace.id, visitorId)
      .first<{ contact_id: string }>();
    if (!identity) return context.json({ data: [] });
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, headline, body, cta_label, cta_url, page_pattern
       FROM site_messages
       WHERE workspace_id = ? AND status = 'published'
         AND (starts_at IS NULL OR starts_at <= ?)
         AND (ends_at IS NULL OR ends_at >= ?)
       ORDER BY updated_at DESC LIMIT 20`,
      )
      .bind(workspace.id, new Date().toISOString(), new Date().toISOString())
      .all<{
        id: string;
        headline: string;
        body: string;
        cta_label: string;
        cta_url: string | null;
        page_pattern: string;
      }>();
    return context.json({
      data: result.results
        .filter((message) => pagePatternMatches(pageUrl, message.page_pattern))
        .slice(0, 1),
    });
  });

  publicApp.post("/api/public/site-messages/:workspaceSlug/:messageId/events", async (context) => {
    const workspace = await loadPublicTrackingWorkspace(
      context.get("database"),
      context.req.param("workspaceSlug"),
    );
    if (!workspace) return context.json({ data: { accepted: false } }, 202);
    const origin = context.req.header("origin");
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return apiError(context, 403, "tracking_origin_denied", "このドメインは許可されていません");
    }
    const parsed = z
      .object({
        visitorId: z.string().uuid(),
        type: z.enum(["impression", "click"]),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return context.json({ data: { accepted: false } }, 202);
    const identity = await context
      .get("database")
      .prepare(
        `SELECT contact_id FROM contact_events
         WHERE workspace_id = ? AND visitor_id = ? AND contact_id IS NOT NULL
         ORDER BY occurred_at DESC LIMIT 1`,
      )
      .bind(workspace.id, parsed.data.visitorId)
      .first<{ contact_id: string }>();
    if (!identity) return context.json({ data: { accepted: false } }, 202);
    const now = new Date().toISOString();
    const messageId = context.req.param("messageId");
    const counter = parsed.data.type === "impression" ? "impression_count" : "click_count";
    const result = await context
      .get("database")
      .prepare(
        `UPDATE site_messages SET ${counter} = ${counter} + 1, updated_at = updated_at
         WHERE workspace_id = ? AND id = ? AND status = 'published'`,
      )
      .bind(workspace.id, messageId)
      .run();
    if (result.meta.changes !== 1) {
      return context.json({ data: { accepted: false } }, 202);
    }
    await context
      .get("database")
      .prepare(
        `INSERT INTO contact_events
         (id, workspace_id, contact_id, visitor_id, type, resource_type,
          resource_id, properties, occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'site_message', ?, '{}', ?, ?)`,
      )
      .bind(
        uuidv7(),
        workspace.id,
        identity.contact_id,
        parsed.data.visitorId,
        parsed.data.type === "impression" ? "site_message_viewed" : "site_message_clicked",
        messageId,
        now,
        now,
      )
      .run();
    return context.json({ data: { accepted: true } }, 202);
  });

  publicApp.get("/t/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "tracking",
    );
    if (payload) {
      context.executionCtx.waitUntil(
        context
          .get("database")
          .prepare(
            `INSERT INTO contact_events
           (id, workspace_id, contact_id, type, resource_type, resource_id,
            properties, occurred_at, created_at)
           VALUES (?, ?, ?, 'email_opened', 'delivery', ?, '{}', ?, ?)`,
          )
          .bind(
            uuidv7(),
            payload.workspaceId,
            payload.contactId ?? null,
            payload.resourceId,
            new Date().toISOString(),
            new Date().toISOString(),
          )
          .run()
          .then(() => undefined),
      );
    }
    return new Response(transparentGif, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, private",
      },
    });
  });

  publicApp.get("/u/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_unsubscribe_token", "解除リンクが無効です");
    }
    const now = new Date().toISOString();
    await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `INSERT OR IGNORE INTO suppressions
         (id, workspace_id, contact_id, reason, created_at)
         VALUES (?, ?, ?, 'global_unsubscribe', ?)`,
        )
        .bind(uuidv7(), payload.workspaceId, payload.contactId, now),
      context
        .get("database")
        .prepare(
          `INSERT INTO consent_events
         (id, workspace_id, contact_id, action, source, created_at)
         VALUES (?, ?, ?, 'unsubscribed', 'one_click', ?)`,
        )
        .bind(uuidv7(), payload.workspaceId, payload.contactId, now),
    ]);
    return context.html(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><title>配信停止</title><body><main><h1>配信を停止しました</h1><p>設定はすぐに反映されます。</p></main></body></html>',
    );
  });

  publicApp.post("/u/:token", async (context) => {
    return context.redirect(`/u/${encodeURIComponent(context.req.param("token"))}`, 303);
  });

  publicApp.get("/preference/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_preference_token", "設定リンクが無効です");
    }
    const topics = await context
      .get("database")
      .prepare(
        `SELECT st.id, st.name, st.description,
              COALESCE(cs.status, 'unsubscribed') AS status
       FROM subscription_topics st
       LEFT JOIN contact_subscriptions cs
         ON cs.workspace_id = st.workspace_id AND cs.topic_id = st.id AND cs.contact_id = ?
       WHERE st.workspace_id = ? ORDER BY st.name`,
      )
      .bind(payload.contactId, payload.workspaceId)
      .all<{ id: string; name: string; description: string; status: string }>();
    const globalSuppression = await context
      .get("database")
      .prepare(
        `SELECT id FROM suppressions
       WHERE workspace_id = ? AND contact_id = ? AND reason = 'global_unsubscribe' LIMIT 1`,
      )
      .bind(payload.workspaceId, payload.contactId)
      .first();
    const rows = topics.results
      .map(
        (topic) => `<label style="display:block;padding:16px 0;border-bottom:1px solid #e2e8f0">
          <input type="checkbox" name="topic" value="${escapeHtml(topic.id)}" ${topic.status === "subscribed" ? "checked" : ""}>
          <strong>${escapeHtml(topic.name)}</strong>
          <span style="display:block;margin-left:24px;color:#64748b">${escapeHtml(topic.description)}</span>
        </label>`,
      )
      .join("");
    return context.html(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>配信設定</title></head>
      <body style="margin:0;background:#f5f7fb;font-family:system-ui;color:#172033"><main style="max-width:640px;margin:48px auto;background:white;padding:32px;border-radius:16px">
      <h1>配信設定</h1><p style="color:#64748b">受け取りたいトピックを選択してください。</p>
      <form method="post">${rows}
      <label style="display:block;padding:20px 0"><input type="checkbox" name="globalStop" ${globalSuppression ? "checked" : ""}> すべてのマーケティングメールを停止</label>
      <button style="border:0;border-radius:10px;background:#6d4aff;color:white;padding:12px 20px;font-weight:700">設定を保存</button>
      </form></main></body></html>`);
  });

  publicApp.post("/preference/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_preference_token", "設定リンクが無効です");
    }
    const form = await context.req.formData();
    const selected = new Set(
      form.getAll("topic").filter((value): value is string => typeof value === "string"),
    );
    const topics = await context
      .get("database")
      .prepare("SELECT id FROM subscription_topics WHERE workspace_id = ?")
      .bind(payload.workspaceId)
      .all<{ id: string }>();
    const now = new Date().toISOString();
    const statements = topics.results.map((topic) =>
      context
        .get("database")
        .prepare(
          `INSERT INTO contact_subscriptions
         (workspace_id, contact_id, topic_id, status, source, updated_at)
         VALUES (?, ?, ?, ?, 'preference_center', ?)
         ON CONFLICT(workspace_id, contact_id, topic_id)
         DO UPDATE SET status = excluded.status, source = excluded.source,
           updated_at = excluded.updated_at`,
        )
        .bind(
          payload.workspaceId,
          payload.contactId,
          topic.id,
          selected.has(topic.id) ? "subscribed" : "unsubscribed",
          now,
        ),
    );
    if (form.get("globalStop")) {
      statements.push(
        context
          .get("database")
          .prepare(
            `INSERT OR IGNORE INTO suppressions
           (id, workspace_id, contact_id, reason, created_at)
           VALUES (?, ?, ?, 'global_unsubscribe', ?)`,
          )
          .bind(uuidv7(), payload.workspaceId, payload.contactId, now),
      );
    } else {
      statements.push(
        context
          .get("database")
          .prepare(
            `DELETE FROM suppressions
           WHERE workspace_id = ? AND contact_id = ? AND reason = 'global_unsubscribe'`,
          )
          .bind(payload.workspaceId, payload.contactId),
      );
    }
    statements.push(
      context
        .get("database")
        .prepare(
          `INSERT INTO consent_events
         (id, workspace_id, contact_id, action, source, proof, created_at)
         VALUES (?, ?, ?, ?, 'preference_center', ?, ?)`,
        )
        .bind(
          uuidv7(),
          payload.workspaceId,
          payload.contactId,
          form.get("globalStop") ? "unsubscribed" : "granted",
          JSON.stringify({ topics: [...selected] }),
          now,
        ),
    );
    await context.get("database").batch(statements);
    return context.html(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><body><main><h1>設定を保存しました</h1><p>変更は次回の送信判定から反映されます。</p></main></body></html>',
    );
  });
}

export function originAllowed(origin: string, allowedDomains: string[]): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return allowedDomains.some((domain) => {
      const allowed = domain.toLowerCase();
      return hostname === allowed || hostname.endsWith(`.${allowed}`);
    });
  } catch {
    return false;
  }
}

export function normalizeDomain(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/\.$/, "");
  } catch {
    return (
      value
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .split("/")[0] ?? ""
    );
  }
}

export function isValidDomain(value: string): boolean {
  return (
    value === "localhost" || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
  );
}

export async function loadPublicTrackingWorkspace(
  database: KaenmaDatabase,
  workspaceSlug: string,
): Promise<{ id: string; allowedDomains: string[] } | null> {
  const row = await database
    .prepare(
      `SELECT o.id, sts.allowed_domains
     FROM organization o JOIN site_tracking_settings sts
       ON sts.workspace_id = o.id
     WHERE o.slug = ? AND sts.enabled = 1`,
    )
    .bind(workspaceSlug)
    .first<{ id: string; allowed_domains: string }>();
  if (!row) return null;
  try {
    return {
      id: row.id,
      allowedDomains: JSON.parse(row.allowed_domains) as string[],
    };
  } catch {
    return null;
  }
}

export function pagePatternMatches(pageUrl: string, pattern: string): boolean {
  if (pattern === "*") return true;
  let path = pageUrl;
  try {
    const url = new URL(pageUrl);
    path = `${url.pathname}${url.search}`;
  } catch {
    // Use the supplied path as-is.
  }
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(path);
}

export function siteTrackingScript(trackingEndpoint: string, messagesEndpoint: string): string {
  return `(() => {
  if (window.kaenma) return;
  const endpoint = ${JSON.stringify(trackingEndpoint)};
  const messagesEndpoint = ${JSON.stringify(messagesEndpoint)};
  const settings = window.kaenmaSettings || {};
  const visitorKey = "kaenma_visitor_" + endpoint.split("/").pop();
  let email = typeof settings.email === "string" ? settings.email : undefined;
  let visitorId = localStorage.getItem(visitorKey) || undefined;

  async function record(type, resourceId, properties = {}) {
    if (settings.consent !== true) return null;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consent: true,
          visitorId,
          email,
          type,
          resourceId,
          properties,
        }),
        keepalive: true,
      });
      const payload = await response.json();
      if (payload?.data?.visitorId) {
        visitorId = payload.data.visitorId;
        localStorage.setItem(visitorKey, visitorId);
      }
      return payload?.data || null;
    } catch {
      return null;
    }
  }

  async function loadMessage() {
    if (!visitorId) return;
    try {
      const url = new URL(messagesEndpoint);
      url.searchParams.set("visitorId", visitorId);
      url.searchParams.set("url", window.location.href);
      const response = await fetch(url);
      const payload = await response.json();
      const message = payload?.data?.[0];
      if (!message || sessionStorage.getItem("kaenma_message_" + message.id)) return;
      sessionStorage.setItem("kaenma_message_" + message.id, "shown");

      const container = document.createElement("aside");
      container.setAttribute("role", "status");
      container.style.cssText =
        "position:fixed;right:20px;bottom:20px;max-width:360px;padding:20px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;color:#111827;box-shadow:0 18px 48px rgba(0,0,0,.18);font:14px/1.5 system-ui,sans-serif;z-index:2147483647";
      const close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "メッセージを閉じる");
      close.textContent = "×";
      close.style.cssText =
        "position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:22px;cursor:pointer;color:#6b7280";
      close.addEventListener("click", () => container.remove());
      const title = document.createElement("strong");
      title.textContent = message.headline;
      title.style.cssText = "display:block;padding-right:22px;font-size:16px";
      const body = document.createElement("p");
      body.textContent = message.body;
      body.style.cssText = "margin:8px 0 0;color:#4b5563";
      container.append(close, title);
      if (message.body) container.append(body);
      if (message.cta_url && message.cta_label) {
        const link = document.createElement("a");
        link.href = message.cta_url;
        link.textContent = message.cta_label;
        link.rel = "noopener noreferrer";
        link.style.cssText =
          "display:inline-block;margin-top:14px;padding:8px 12px;border-radius:8px;background:#111827;color:#fff;text-decoration:none;font-weight:600";
        link.addEventListener("click", () => {
          void messageEvent(message.id, "click");
        });
        container.append(link);
      }
      document.body.append(container);
      void messageEvent(message.id, "impression");
    } catch {
      // Tracking must never interrupt the host page.
    }
  }

  function messageEvent(messageId, type) {
    return fetch(messagesEndpoint + "/" + encodeURIComponent(messageId) + "/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId, type }),
      keepalive: true,
    });
  }

  async function page() {
    const result = await record("page_viewed", window.location.href, {
      title: document.title,
      referrer: document.referrer,
    });
    if (result?.identified) await loadMessage();
  }

  window.kaenma = {
    consent() {
      settings.consent = true;
      void page();
    },
    identify(value) {
      email = value;
      void page();
    },
    track(name, properties) {
      return record("custom_event", name, properties);
    },
  };

  if (settings.consent === true) void page();
})();`;
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

export function redactFormPayload(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  delete result["turnstileToken"];
  delete result["_website"];
  return result;
}

export async function hashIp(value?: string): Promise<string | null> {
  return value ? sha256Hex(value) : null;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 191) : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderPublicForm(
  name: string,
  definition: Record<string, unknown>,
  actionUrl: string,
): string {
  const configuredFields = Array.isArray(definition["fields"])
    ? definition["fields"].filter(isRecord)
    : [];
  const supported = new Map([
    ["email", { label: "メールアドレス", type: "email", required: true }],
    ["firstName", { label: "名", type: "text", required: false }],
    ["lastName", { label: "姓", type: "text", required: false }],
    ["phone", { label: "電話番号", type: "tel", required: false }],
  ]);
  const fields = configuredFields
    .map((field) => {
      const key = typeof field["key"] === "string" ? field["key"] : "";
      const base = supported.get(key);
      return base
        ? {
            key,
            ...base,
            required: key === "email" || field["required"] === true,
          }
        : null;
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);
  if (!fields.some((field) => field.key === "email")) {
    fields.unshift({
      key: "email",
      label: "メールアドレス",
      type: "email",
      required: true,
    });
  }
  const controls = fields
    .map(
      (field) =>
        `<label>${escapeHtml(field.label)}<input name="${escapeHtml(field.key)}" type="${field.type}"${field.required ? " required" : ""}></label>`,
    )
    .join("");
  const endpoint = escapeHtml(actionUrl.split("?")[0] ?? actionUrl);
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(name)}</title>
  <style>
    :root{color-scheme:light;font-family:system-ui,sans-serif;color:#111827}
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#fff}
    form{display:grid;gap:16px;max-width:520px;margin:auto}
    h1{margin:0;font-size:24px}label{display:grid;gap:6px;font-size:14px;font-weight:600}
    input{width:100%;height:42px;border:1px solid #d1d5db;border-radius:8px;padding:0 12px;font:inherit}
    button{height:42px;border:0;border-radius:8px;background:#111827;color:#fff;font:inherit;font-weight:700;cursor:pointer}
    p{margin:0;color:#4b5563;font-size:14px}.hidden{position:absolute;left:-9999px}
  </style>
</head>
<body>
  <form id="signup-form">
    <h1>${escapeHtml(name)}</h1>
    ${controls}
    <label class="hidden" aria-hidden="true">Website<input name="_website" tabindex="-1" autocomplete="off"></label>
    <button type="submit">送信する</button>
    <p id="result" role="status"></p>
  </form>
  <script>
    document.getElementById("signup-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const result = document.getElementById("result");
      button.disabled = true;
      result.textContent = "送信しています…";
      try {
        const payload = Object.fromEntries(new FormData(form));
        payload.idempotencyKey = crypto.randomUUID();
        const response = await fetch("${endpoint}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message || "送信できませんでした");
        result.textContent = body?.data?.message || "ありがとうございます。";
        form.reset();
      } catch (error) {
        result.textContent = error instanceof Error ? error.message : "送信できませんでした";
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export function formEmbedScript(formUrl: string, formName: string, style: string): string {
  return `(() => {
  const current = document.currentScript;
  const frame = document.createElement("iframe");
  frame.src = ${JSON.stringify(formUrl)};
  frame.title = ${JSON.stringify(formName)};
  frame.loading = "lazy";
  frame.style.cssText = "border:0;background:#fff;width:100%";
  const style = ${JSON.stringify(style)};

  if (style === "inline") {
    frame.style.height = "520px";
    current?.parentNode?.insertBefore(frame, current.nextSibling);
    return;
  }

  if (style === "floating-bar") {
    frame.style.cssText += ";position:fixed;left:0;bottom:0;height:230px;box-shadow:0 -10px 32px rgba(0,0,0,.14);z-index:2147483646";
    document.body.append(frame);
    return;
  }

  if (style === "floating-box") {
    frame.style.cssText += ";position:fixed;right:20px;bottom:20px;width:min(380px,calc(100vw - 40px));height:480px;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.18);z-index:2147483646";
    document.body.append(frame);
    return;
  }

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", ${JSON.stringify(formName)});
  overlay.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.45);z-index:2147483646";
  frame.style.cssText += ";max-width:560px;height:540px;border-radius:14px";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "フォームを閉じる");
  close.textContent = "×";
  close.style.cssText = "position:absolute;right:24px;top:16px;border:0;background:transparent;color:#fff;font-size:32px;cursor:pointer";
  close.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.append(frame, close);
  document.body.append(overlay);
})();`;
}

const transparentGif = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0,
  44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);
