import { ymdOf } from "@/lib/dates";

/**
 * Which day of which phase falls on which date. A phase's day `index` counts days from
 * its start date, and week `order` is 1-based, so a day's date is plain arithmetic.
 */

type ScheduledDay = { id: string; index: number; rest: boolean };
type ScheduledWeek<D extends ScheduledDay> = { order: number; days: D[] };
type ScheduledBlock<D extends ScheduledDay> = {
  id: string;
  /** Only needed when an active program is picked. */
  programId?: string;
  startDate: Date | string;
  weeks: ScheduledWeek<D>[];
};

export type Session<B, D> = {
  ymd: string;
  block: B;
  week: number;
  day: D;
  /** Where the plan put it, when the athlete moved it to `ymd`. */
  movedFrom?: string;
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

/** No session moved. */
export const NO_MOVES: ReadonlyMap<string, string> = new Map();

/** The date a session is done on: where the athlete moved it, else where the plan has it. */
export function sessionDate(
  startDate: Date | string,
  week: number,
  day: { id: string; index: number },
  moves: ReadonlyMap<string, string> = NO_MOVES,
): string {
  return moves.get(day.id) ?? dateOfDay(startDate, week, day.index);
}

export function dateOfDay(startDate: Date | string, week: number, dayIndex: number): string {
  return addDays(ymdOf(startDate), (week - 1) * 7 + dayIndex);
}

/** The 1-based week a phase is in on `today` (`YYYY-MM-DD`), null before or after it. */
export function weekOn(startDate: Date | string, weeks: number, today: string): number | null {
  const elapsed = daysBetween(ymdOf(startDate), today);
  return elapsed >= 0 && elapsed < weeks * 7 ? Math.floor(elapsed / 7) + 1 : null;
}

/**
 * The program a date belongs to, of those with a phase running on it: the `active` one,
 * else the one that started last — the plan the coach wrote most recently. Only one
 * program is ever trained at a time; on its days the others do nothing, rest days included.
 */
export function programOn(
  phases: { programId?: string; startDate: Date | string; weeks: number }[],
  ymd: string,
  active?: string | null,
): string | undefined {
  const starts = new Map<string, string>();
  for (const p of phases) {
    const id = p.programId ?? "";
    const start = ymdOf(p.startDate);
    const first = starts.get(id);
    if (first === undefined || start < first) starts.set(id, start);
  }
  let owner: string | undefined;
  for (const p of phases) {
    const id = p.programId ?? "";
    if (weekOn(p.startDate, p.weeks, ymd) === null || id === owner || (active && owner === active)) continue;
    if (owner === undefined || id === active || starts.get(id)! > starts.get(owner)!) owner = id;
  }
  return owner;
}

/**
 * Every training day of every phase, in date order. Only the program that owns a date
 * (`programOn`) puts a session on it. Where two of its phases overlap, the one that
 * started later wins — it is the plan the coach wrote most recently. `moves`
 * maps a session to the date the athlete moved it to; a moved session wins its new date
 * over anything the plan puts there, since the athlete chose it knowing what was there.
 */
export function sessionsOf<D extends ScheduledDay, B extends ScheduledBlock<D>>(
  blocks: B[],
  moves: ReadonlyMap<string, string> = new Map(),
  active?: string | null,
): Session<B, D>[] {
  // Compared as strings: "1" (active program) beats "0", then the later start date.
  type Held = Session<B, D> & { start: string };
  const byDate = new Map<string, Held>();
  const moved: Held[] = [];
  const spans = blocks.map((b) => ({ programId: b.programId, startDate: b.startDate, weeks: b.weeks.length }));
  for (const block of blocks) {
    const start = (active && block.programId === active ? "1" : "0") + ymdOf(block.startDate);
    for (const week of block.weeks) {
      for (const day of week.days) {
        if (day.rest) continue;
        const planned = dateOfDay(block.startDate, week.order, day.index);
        if (programOn(spans, planned, active) !== (block.programId ?? "")) continue;
        const to = moves.get(day.id);
        if (to !== undefined && to !== planned) {
          moved.push({ ymd: to, block, week: week.order, day, start, movedFrom: planned });
          continue;
        }
        const held = byDate.get(planned);
        if (held && held.start > start) continue;
        byDate.set(planned, { ymd: planned, block, week: week.order, day, start });
      }
    }
  }
  for (const m of moved) {
    const held = byDate.get(m.ymd);
    if (held?.movedFrom !== undefined && held.start > m.start) continue;
    byDate.set(m.ymd, m);
  }
  return [...byDate.values()]
    .sort((a, b) => a.ymd.localeCompare(b.ymd))
    .map(({ ymd, block, week, day, movedFrom }) => (movedFrom === undefined ? { ymd, block, week, day } : { ymd, block, week, day, movedFrom }));
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
