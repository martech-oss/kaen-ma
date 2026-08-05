import type { AutomationNode } from "@openengage/orpc";

type DelayNode = Extract<AutomationNode, { type: "delay" }>;

export function computeDueAt(node: DelayNode, now: Date, timezone: string): Date {
  const config = node.config;
  if (config.mode === "relative") {
    return new Date(now.getTime() + config.minutes * 60_000);
  }
  if (config.mode === "absolute") return new Date(config.at);

  const candidate = new Date(now.getTime() + config.minutes * 60_000);
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const parts = zonedParts(new Date(candidate.getTime() + dayOffset * 86_400_000), timezone);
    if (!config.weekdays.includes(parts.weekday)) continue;
    if (parts.hour < config.startHour) {
      return shiftToZonedHour(
        new Date(candidate.getTime() + dayOffset * 86_400_000),
        timezone,
        config.startHour,
      );
    }
    if (parts.hour < config.endHour) {
      return new Date(candidate.getTime() + dayOffset * 86_400_000);
    }
  }
  throw new Error("Unable to find a delivery window within 14 days");
}

function zonedParts(date: Date, timezone: string): { weekday: number; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    weekday: weekdays[parts.weekday ?? "Sun"] ?? 0,
    hour: Number(parts.hour ?? "0") % 24,
  };
}

function shiftToZonedHour(date: Date, timezone: string, targetHour: number): Date {
  const current = zonedParts(date, timezone).hour;
  const delta = (targetHour - current + 24) % 24;
  const shifted = new Date(date.getTime() + delta * 3_600_000);
  shifted.setUTCMinutes(0, 0, 0);
  return shifted;
}
