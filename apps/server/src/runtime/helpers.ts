export function safeRecord(value: string): Record<string, unknown>;

export function safeRecord(value: unknown): Record<string, unknown>;

export function safeRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return safeRecord(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}
