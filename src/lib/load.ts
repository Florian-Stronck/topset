import type { IntensityType } from "@prisma/client";
import { addDays } from "@/lib/schedule";
import { rpeOf } from "@/lib/setlog";

/**
 * Training load the way combat-sport coaches count it: session RPE × minutes (Foster), in
 * arbitrary units. Only timed rows count — rounds and intervals have minutes; a set of
 * five squats doesn't — so this is the mat and conditioning work, not the lifting.
 *
 * Planned load is rounds × round length × the RPE written; done load is each round ticked
 * off, for as long as it took, at the effort logged (else the one written).
 */

export type TimedRow = {
  /** The day it falls on, `YYYY-MM-DD`. */
  ymd: string;
  sets: number | null;
  /** Seconds per round. */
  duration: number;
  intensityType: IntensityType;
  intensity: number | null;
  logs: { seconds?: number | null; rpe: number | null; rir: number | null; done: boolean }[];
};

export type DayLoad = { planned: number; done: number; minutes: number };

/**
 * The effort a row asks for, as an RPE; null when it is written as a weight. On a round a
 * % is how hard to go — sparring at 70% is an RPE of 7.
 */
function writtenRpe(row: Pick<TimedRow, "intensityType" | "intensity">): number | null {
  if (row.intensity === null) return null;
  if (row.intensityType === "RPE") return row.intensity;
  if (row.intensityType === "RIR") return 10 - row.intensity;
  if (row.intensityType === "PERCENT") return Math.min(10, Math.max(0, row.intensity / 10));
  return null;
}

export function rowLoad(row: TimedRow): DayLoad {
  const rpe = writtenRpe(row);
  const rounds = Math.max(1, row.sets ?? 1);
  const planned = rpe === null ? 0 : (rounds * row.duration * rpe) / 60;
  let done = 0;
  let minutes = 0;
  for (const log of row.logs) {
    if (!log.done) continue;
    const m = (log.seconds ?? row.duration) / 60;
    minutes += m;
    done += m * (rpeOf(log) ?? rpe ?? 0);
  }
  return { planned, done, minutes };
}

/** Load per day, days with nothing timed left out. */
export function dailyLoad(rows: TimedRow[]): Map<string, DayLoad> {
  const out = new Map<string, DayLoad>();
  for (const row of rows) {
    const l = rowLoad(row);
    const day = out.get(row.ymd) ?? { planned: 0, done: 0, minutes: 0 };
    day.planned += l.planned;
    day.done += l.done;
    day.minutes += l.minutes;
    out.set(row.ymd, day);
  }
  return out;
}

const round = (n: number) => Math.round(n);

export type WeekLoad = {
  /** The week's first day. */
  start: string;
  planned: number;
  done: number;
  minutes: number;
  /** Mean daily load over its spread; high means every day looks the same. Null for a flat or empty week. */
  monotony: number | null;
  /** Load × monotony. */
  strain: number | null;
};

/** The seven days from `start`, as one week's numbers. */
export function weekLoad(daily: Map<string, DayLoad>, start: string): WeekLoad {
  const days = Array.from({ length: 7 }, (_, i) => daily.get(addDays(start, i)) ?? { planned: 0, done: 0, minutes: 0 });
  const done = days.reduce((n, d) => n + d.done, 0);
  const mean = done / 7;
  const sd = Math.sqrt(days.reduce((n, d) => n + (d.done - mean) ** 2, 0) / 7);
  const monotony = done > 0 && sd > 0 ? Math.round((mean / sd) * 100) / 100 : null;
  return {
    start,
    planned: round(days.reduce((n, d) => n + d.planned, 0)),
    done: round(done),
    minutes: round(days.reduce((n, d) => n + d.minutes, 0)),
    monotony,
    strain: monotony === null ? null : round(done * monotony),
  };
}

/**
 * Acute:chronic workload ratio on a day: the last 7 days' load against the weekly average
 * of the last 28. Around 0.8–1.3 is the usual comfortable band; well over 1.5 is a spike.
 * Null until there are four weeks of load to compare with.
 */
export function acwr(daily: Map<string, DayLoad>, today: string): number | null {
  let acute = 0;
  let chronic = 0;
  for (let i = 0; i < 28; i++) {
    const d = daily.get(addDays(today, -i))?.done ?? 0;
    if (i < 7) acute += d;
    chronic += d;
  }
  const first = [...daily.entries()].filter(([, d]) => d.done > 0).map(([ymd]) => ymd).sort()[0];
  if (!first || first > addDays(today, -21) || chronic === 0) return null;
  return Math.round((acute / (chronic / 4)) * 100) / 100;
}

/** "ok", "low" or "spike" for an ACWR, for colouring it. */
export function acwrZone(ratio: number): "low" | "ok" | "high" | "spike" {
  if (ratio < 0.8) return "low";
  if (ratio <= 1.3) return "ok";
  if (ratio <= 1.5) return "high";
  return "spike";
}
