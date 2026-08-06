import { orpcQuery } from "@/lib/orpc";

export function dashboardQueryOptions() {
  return orpcQuery.dashboard.get.queryOptions();
}

const DELIVERY_TREND_DAYS = 7;

/** ISO date range covering today and the 6 days before it, oldest first. */
function lastSevenDaysRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - (DELIVERY_TREND_DAYS - 1));
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

export function deliveryTrendQueryOptions() {
  return orpcQuery.reports.emails.queryOptions({ input: lastSevenDaysRange() });
}

export interface DeliveryHealthPoint {
  day: string;
  deliveryRate: number;
}

/** Delivered/sends per day, as a percentage rounded to one decimal place. */
export function toDeliveryHealthTrend(
  trend: Array<{ day: string; sends: number; delivered: number }>,
): DeliveryHealthPoint[] {
  return trend.map((point) => ({
    day: point.day,
    deliveryRate: point.sends > 0 ? Math.round((point.delivered / point.sends) * 1000) / 10 : 0,
  }));
}
