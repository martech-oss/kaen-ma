export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 191) : null;
}

export function primitiveString(value: unknown, fallback = ""): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return fallback;
}

/** Coerces values returned by aggregate SQL expressions to a number. */
export function numericValue(value: unknown): number {
  return Number(value ?? 0);
}

/** Reads a nullable text column while preserving its nullability. */
export function nullablePrimitiveString(value: unknown): string | null {
  return value === null || value === undefined ? null : primitiveString(value);
}

/** Parses a JSON text column, returning the provided fallback for invalid values. */
export function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Reads an object-shaped JSON column without leaking non-object values. */
export function parseJsonRecord(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? parseJsonValue<unknown>(value, null) : value;
  return isRecord(parsed) ? parsed : {};
}

/** Worker-side variant of stringOrNull with a longer limit for event payloads. */
export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

export function sanitizeFilename(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 191);
}

export function resourceSlug(value: string, fallbackId: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || `item-${fallbackId.slice(0, 8)}`;
}
