import type { Hono } from "hono";

import { uuidv7 } from "@kaenma/database";

import { verifySignedToken } from "../crypto";
import type { AppEnvironment } from "../env";
import { apiError } from "../middleware";
import { escapeHtml } from "./html";

export function registerPublicPreferenceRoutes(publicApp: Hono<AppEnvironment>): void {
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
