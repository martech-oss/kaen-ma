import type { KaenmaDatabase } from "@kaenma/database";

export type ReportDatabase = KaenmaDatabase;

export interface ReportRange {
  from: string;
  to: string;
  fromTimestamp: string;
  toExclusiveTimestamp: string;
}

export function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

export function toReportRange(from: string, to: string): ReportRange {
  const toExclusive = new Date(`${to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return {
    from,
    to,
    fromTimestamp: `${from}T00:00:00.000Z`,
    toExclusiveTimestamp: toExclusive.toISOString(),
  };
}

export function publicRange(range: ReportRange) {
  return { from: range.from, to: range.to };
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function rows(result: D1Result | undefined): Record<string, unknown>[] {
  return (result?.results ?? []) as Record<string, unknown>[];
}

export function firstRow(result: D1Result | undefined): Record<string, unknown> {
  return rows(result)[0] ?? {};
}

export function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}
