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
