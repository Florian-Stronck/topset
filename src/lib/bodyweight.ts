import { addDays, daysBetween } from "@/lib/schedule";

/**
 * Bodyweight, as the athlete (or coach) logs it: any day, as often as they like. Several
 * weigh-ins on one day read as that day's last one; trends are 7-day averages, which
 * smooth out water and salt the way a coach reads a scale anyway.
 */

export type BodyweightEntry = {
  id: string;
  /** The day it was weighed, `YYYY-MM-DD`. */
  day: string;
  /** In the athlete's own unit. */
  weight: number;
  note: string | null;
  source: "athlete" | "coach";
  /** When it was written, ISO — orders several entries on the same day. */
  createdAt: string;
};

/** A stored weigh-in as the screens take it. */
export function bodyweightEntry(row: {
  id: string;
  day: string;
  weight: number;
  note: string | null;
  source: string;
  createdAt: Date;
}): BodyweightEntry {
  return { ...row, source: row.source === "coach" ? "coach" : "athlete", createdAt: row.createdAt.toISOString() };
}

export type DailyWeight = { day: string; weight: number };

/** One weight per day — the last one entered that day — oldest first. */
export function dailyWeights(entries: Pick<BodyweightEntry, "day" | "weight" | "createdAt">[]): DailyWeight[] {
  const byDay = new Map<string, { weight: number; createdAt: string }>();
  for (const e of entries) {
    const held = byDay.get(e.day);
    if (!held || e.createdAt >= held.createdAt) byDay.set(e.day, { weight: e.weight, createdAt: e.createdAt });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { weight }]) => ({ day, weight }));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Mean of the daily weights in the 7 days up to and including `day`; null if none. */
export function averageAround(daily: DailyWeight[], day: string, span = 7): number | null {
  const from = addDays(day, -(span - 1));
  const inside = daily.filter((d) => d.day >= from && d.day <= day);
  if (inside.length === 0) return null;
  return round1(inside.reduce((n, d) => n + d.weight, 0) / inside.length);
}

/** The 7-day average at every logged day, for the line drawn through the dots. */
export function rollingAverage(daily: DailyWeight[], span = 7): DailyWeight[] {
  return daily.map((d) => ({ day: d.day, weight: averageAround(daily, d.day, span) ?? d.weight }));
}

export type BodyweightSummary = {
  latest: DailyWeight | null;
  /** Days since the latest weigh-in. */
  age: number | null;
  /** 7-day average up to today. */
  avg7: number | null;
  /** That average against the one a week earlier; null without both. */
  change7: number | null;
};

export function bodyweightSummary(daily: DailyWeight[], today: string): BodyweightSummary {
  const past = daily.filter((d) => d.day <= today);
  const latest = past[past.length - 1] ?? null;
  const avg7 = averageAround(past, today);
  const before = averageAround(past, addDays(today, -7));
  return {
    latest,
    age: latest ? daysBetween(latest.day, today) : null,
    avg7,
    change7: avg7 !== null && before !== null ? round1(avg7 - before) : null,
  };
}

/**
 * The upper limit of a weight class as written on a meet: "83", "-83", "u83", "83kg",
 * "83 kg" → 83. An open-ended class ("120+", "+120", "SHW") has no limit, so null.
 */
export function classLimit(weightClass: string | null | undefined): number | null {
  if (!weightClass) return null;
  const text = weightClass.trim().toLowerCase().replace(",", ".");
  if (text === "" || text.includes("+") || /shw|open/.test(text)) return null;
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const limit = Number(match[1]);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

/** How far back the projection looks, and the least it needs to go on. */
const TREND_DAYS = 21;
const TREND_MIN_POINTS = 4;
const TREND_MIN_SPAN = 7;

export type Projection = {
  /** Where the trend lands on the day asked for. */
  weight: number;
  /** The trend's slope, per week. */
  perWeek: number;
};

/**
 * The bodyweight trend carried forward: a straight line fitted through the last three
 * weeks of daily weights, read off at `day`. Null without enough weigh-ins to trust it —
 * at least four, a week or more apart end to end.
 */
export function projectWeight(daily: DailyWeight[], today: string, day: string): Projection | null {
  const from = addDays(today, -(TREND_DAYS - 1));
  const points = daily.filter((d) => d.day >= from && d.day <= today);
  if (points.length < TREND_MIN_POINTS) return null;
  if (daysBetween(points[0].day, points[points.length - 1].day) < TREND_MIN_SPAN) return null;

  const xs = points.map((p) => daysBetween(today, p.day));
  const ys = points.map((p) => p.weight);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const at = my + slope * (daysBetween(today, day) - mx);
  return { weight: round1(at), perWeek: round1(slope * 7) };
}
