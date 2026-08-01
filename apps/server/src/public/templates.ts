import { isRecord } from "../platform/values";
import { escapeHtml } from "./html";

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
