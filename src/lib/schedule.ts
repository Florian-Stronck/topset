import { ymdOf } from "@/lib/dates";

/**
 * Which day of which phase falls on which date. A phase's day `index` counts days from
 * its start date, and week `order` is 1-based, so a day's date is plain arithmetic.
 */

type ScheduledDay = { id: string; index: number; rest: boolean };
type ScheduledWeek<D extends ScheduledDay> = { order: number; days: D[] };
type ScheduledBlock<D extends ScheduledDay> = {
  id: string;
  startDate: Date | string;
  weeks: ScheduledWeek<D>[];
};

export type Session<B, D> = {
  ymd: string;
  block: B;
  week: number;
  day: D;
};

/** `YYYY-MM-DD` plus `n` days. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function dateOfDay(startDate: Date | string, week: number, dayIndex: number): string {
  return addDays(ymdOf(startDate), (week - 1) * 7 + dayIndex);
}

/**
 * Every training day of every phase, in date order. Where two phases overlap on a date,
 * the one that started later wins — it is the plan the coach wrote most recently.
 */
export function sessionsOf<D extends ScheduledDay, B extends ScheduledBlock<D>>(
  blocks: B[],
): Session<B, D>[] {
  const byDate = new Map<string, Session<B, D> & { start: string }>();
  for (const block of blocks) {
    const start = ymdOf(block.startDate);
    for (const week of block.weeks) {
      for (const day of week.days) {
        if (day.rest) continue;
        const ymd = dateOfDay(block.startDate, week.order, day.index);
        const held = byDate.get(ymd);
        if (held && held.start > start) continue;
        byDate.set(ymd, { ymd, block, week: week.order, day, start });
      }
    }
  }
  return [...byDate.values()]
    .sort((a, b) => a.ymd.localeCompare(b.ymd))
    .map(({ ymd, block, week, day }) => ({ ymd, block, week, day }));
}

/** The session on a date, if there is one. */
export function sessionOn<B, D>(sessions: Session<B, D>[], ymd: string): Session<B, D> | null {
  return sessions.find((s) => s.ymd === ymd) ?? null;
}

/** The closest session after a date, for "nothing today — next up Thursday". */
export function nextSession<B, D>(sessions: Session<B, D>[], ymd: string): Session<B, D> | null {
  return sessions.find((s) => s.ymd > ymd) ?? null;
}

/** The closest session before a date. */
export function previousSession<B, D>(sessions: Session<B, D>[], ymd: string): Session<B, D> | null {
  for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].ymd < ymd) return sessions[i];
  return null;
}
