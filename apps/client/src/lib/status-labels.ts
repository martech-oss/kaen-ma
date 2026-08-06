/**
 * Canonical Japanese text for resource lifecycle statuses, shared so the
 * per-resource badges (automations, website content) and the cross-resource
 * reports rollup show the same word for the same state instead of drifting
 * (e.g. an active automation reading "稼働中" on its own page but "有効" in
 * the reports summary).
 */
export const RESOURCE_STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  active: "稼働中",
  paused: "一時停止",
  archived: "アーカイブ",
  published: "公開中",
};

/**
 * Japanese wording for the contact-event types the workspace records. Events
 * arriving from the API or a webhook carry caller-defined names, so anything
 * missing here is shown verbatim rather than guessed at.
 */
export const CONTACT_EVENT_LABELS: Record<string, string> = {
  page_viewed: "ページを閲覧",
  form_submitted: "フォームを送信",
  contact_created: "連絡先を作成",
  contact_archived: "連絡先をアーカイブ",
  segment_joined: "セグメントに参加",
  delivered: "メールが到達",
  opened: "メールを開封",
  email_opened: "メールを開封",
  clicked: "リンクをクリック",
  email_clicked: "リンクをクリック",
  email_replied: "メールに返信",
  bounced: "メールがバウンス",
  complained: "迷惑メール報告",
  unsubscribed: "配信を停止",
};

export type EventTone = "success" | "danger" | "info" | "neutral";

const EVENT_TONES: Record<string, EventTone> = {
  page_viewed: "info",
  form_submitted: "success",
  contact_created: "info",
  contact_archived: "neutral",
  segment_joined: "info",
  delivered: "success",
  opened: "success",
  email_opened: "success",
  clicked: "success",
  email_clicked: "success",
  email_replied: "success",
  bounced: "danger",
  complained: "danger",
  unsubscribed: "danger",
};

/** Severity colour band for an event type; unknown API/webhook events stay neutral. */
export function contactEventTone(type: string): EventTone {
  return EVENT_TONES[type] ?? "neutral";
}
