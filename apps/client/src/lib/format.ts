/**
 * Shared display formatters.
 *
 * The date helpers render deliberately different shapes, so they are separate
 * functions rather than one parameterised helper. Each is documented with the
 * exact output it produces for 2026-07-30T14:05:00Z in Asia/Tokyo — pick by
 * that, not by name similarity.
 */

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const longDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

const monthDayTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
});

/** `2026年7月30日` */
export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

/** `2026年7月30日 23:05` */
export function formatLongDateTime(value: string): string {
  return longDateTimeFormatter.format(new Date(value));
}

/** `2026/07/30 23:05` */
export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

/** `7月30日 23:05` — omits the year, for dates close to now such as task due dates. */
export function formatMonthDayTime(value: string): string {
  return monthDayTimeFormatter.format(new Date(value));
}

/** `7/30` — takes a date-only `YYYY-MM-DD` string and reads it as local midnight. */
export function formatShortDate(value: string): string {
  return shortDateFormatter.format(new Date(`${value}T00:00:00`));
}

/** `¥1,234` for JPY, `$1,234.00` otherwise. Falls back to plain text on an unknown currency code. */
export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency}`;
  }
}

/** `12.34%` — expects an already-computed percentage, not a 0..1 ratio. See {@link rate}. */
export function formatPercent(value: number): string {
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
}

/** Percentage of `numerator` over `denominator`, rounded to 2 decimals. Zero when `denominator` is 0. */
export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

/** Formats an ISO timestamp for a `<input type="datetime-local">` value, in the viewer's timezone. */
export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
