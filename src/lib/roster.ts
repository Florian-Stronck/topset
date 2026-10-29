import type { Unit } from "@prisma/client";
import { completionPct, daySets, rpeDrift } from "@/lib/compliance";
import { estimate1RM, liftOf, rpeTableFor } from "@/lib/intensity";
import type { TrainingSession } from "@/lib/overview";
import type { LiftKey } from "@/lib/progress";
import { addDays } from "@/lib/schedule";
import { topSetOf } from "@/lib/tracking";

/**
 * The Overview's roster table: each athlete over the last weeks, worked out from sessions
 * and check-ins already loaded — how much got done, RPE against the plan, readiness, and
 * where the main lifts' estimated maxes are heading. Nothing here reads the database.
 */

/** How many weeks the done heatmap shows, and how far back the trend lines reach. */
export const DONE_WEEKS = 6;
export const TREND_WEEKS = 8;

/** The first day of each of the last `n` weeks, oldest first, `thisWeek` last. */
export function weekStarts(thisWeek: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(thisWeek, -7 * (n - 1 - i)));
}

const inWeek = (ymd: string, start: string) => ymd >= start && ymd < addDays(start, 7);

/** Share of the sets due each week that were done; null for a week with nothing due. */
export function weeklyDone(sessions: Pick<TrainingSession, "ymd" | "rows">[], weeks: string[], today: string): (number | null)[] {
  const sets = sessions.map((s) => ({ ymd: s.ymd, ...daySets(s.rows) })).filter((s) => s.prescribed > 0);
  // Like the week's cells: a day counts once it has passed, or as soon as anything in it is done.
  const due = sets.filter((s) => s.ymd < today || (s.ymd === today && s.done > 0));
  return weeks.map((w) => completionPct(due.filter((s) => inWeek(s.ymd, w))));
}

/** Logged RPE against the plan, averaged per week; null for a week without any. */
export function weeklyDrift(sessions: Pick<TrainingSession, "ymd" | "rows">[], weeks: string[]): (number | null)[] {
  return weeks.map((w) => rpeDrift(sessions.filter((s) => inWeek(s.ymd, w)).flatMap((s) => s.rows)).mean);
}

/** The week's mean readiness out of 5, one decimal; null for a week with no answers. */
export function weeklyReadiness(points: { day: string; score: number | null }[], weeks: string[]): (number | null)[] {
  return weeks.map((w) => {
    const scores = points.filter((p) => p.score !== null && inWeek(p.day, w)).map((p) => p.score as number);
    return scores.length === 0 ? null : Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  });
}

export type LiftTrend = {
  /** The best estimated 1RM of the last four weeks. */
  e1rm: number | null;
  /** Percent against the best of the four weeks before, one decimal. */
  change: number | null;
};

export const TREND_DAYS = 28;

/**
 * Each main lift's best estimated 1RM over the last four weeks, from the top set of every
 * primary row, and how far it moved against the four weeks before.
 */
export function liftTrends(
  sessions: Pick<TrainingSession, "ymd" | "rows">[],
  today: string,
  unit: Unit,
  rpeTable?: string | null,
): Record<LiftKey, LiftTrend> {
  const table = rpeTableFor({ rpeTable });
  const recentFrom = addDays(today, -(TREND_DAYS - 1));
  const priorFrom = addDays(today, -(TREND_DAYS * 2 - 1));
  const best: Record<LiftKey, [number | null, number | null]> = { squat: [null, null], bench: [null, null], dead: [null, null] };
  for (const s of sessions) {
    if (s.ymd > today || s.ymd < priorFrom) continue;
    const slot = s.ymd >= recentFrom ? 0 : 1;
    for (const row of s.rows) {
      if (row.tier !== "PRIMARY") continue;
      const lift = liftOf(row.target);
      const top = lift ? topSetOf(row) : null;
      if (!lift || !top) continue;
      const e1rm = estimate1RM(top.weight, top.reps, top.rpe, unit, table);
      if (e1rm !== null && e1rm > (best[lift][slot] ?? 0)) best[lift][slot] = e1rm;
    }
  }
  const trend = ([recent, prior]: [number | null, number | null]): LiftTrend => ({
    e1rm: recent,
    change: recent !== null && prior !== null ? Math.round((recent / prior - 1) * 1000) / 10 : null,
  });
  return { squat: trend(best.squat), bench: trend(best.bench), dead: trend(best.dead) };
}

/** The roster table's row for one athlete. Plain data, so it can cross to the client. */
export type RosterRow = {
  id: string;
  name: string;
  unit: "kg" | "lb";
  /** Tracking, at the phase and week the athlete is in. */
  href: string;
  programHref: string;
  phase: { name: string; program: string; status: "upcoming" | "active" | "done"; week: number; of: number; start: string } | null;
  daysLeft: number | null;
  /** A session on the plan today. */
  training: boolean;
  /** The last day anything was logged. */
  lastLog: string | null;
  /** Share of sets done, `DONE_WEEKS` weeks, this one last. */
  done: (number | null)[];
  weekPct: number | null;
  /** RPE against the plan and readiness, `TREND_WEEKS` weeks, this one last. */
  rpe: (number | null)[];
  readiness: (number | null)[];
  /** The phase being trained, whose own maxes win over the athlete's when it has them. */
  phaseId: string | null;
  lifts: Record<LiftKey, LiftTrend & { onFile: number | null; onPhase: boolean }>;
  bodyweight: { weight: number; change7: number | null; overClass: number | null; age: number | null } | null;
  meet: { name: string; days: number; weightClass: string | null; limit: number | null; projected: number | null } | null;
};

/** The last value that isn't null, or null. */
export function latest<T>(values: (T | null)[]): T | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
}

/** What the trends say is worth the coach's while, one roster row at a time. */
export type Suggestion = {
  /** Stays the same while the finding does, so it can be dismissed. */
  key: string;
  athleteId: string;
  tone: "miss" | "warn" | "ok";
  title: string;
  why: string;
  /** Raise a 1RM on file to the estimate. */
  max?: { lift: LiftKey; value: number };
};

/** How far an estimate has to clear the max on file before raising it is worth a word. */
export const RAISE_MAX = 1.025;
/** A lift that moved less than this percent in four weeks, while trained, has stalled. */
export const STALL_PCT = 0.5;

/**
 * The findings: readiness sliding while RPE climbs, an estimate well past the max on file,
 * a lift that stopped moving while the others went up, and RPE running under the plan.
 * Words come from `say`, so the caller translates.
 */
export function suggestionsFor(
  row: RosterRow,
  say: {
  rundown: (from: number, to: number, drift: number | null) => { title: string; why: string };
  raise: (lift: LiftKey, from: number, to: number) => { title: string; why: string };
  stall: (lift: LiftKey, e1rm: number) => { title: string; why: string };
  push: (drift: number) => { title: string; why: string };
  },
): Suggestion[] {
  const out: Suggestion[] = [];
  const ready = row.readiness.filter((r): r is number => r !== null).slice(-3);
  const drift = latest(row.rpe);
  const sliding = ready.length === 3 && ready[0] > ready[1] && ready[1] > ready[2];
  if (ready.length > 0 && (sliding || ready[ready.length - 1] <= 2.5) && (drift === null || drift >= 0)) {
    out.push({ key: `rundown-${row.id}`, athleteId: row.id, tone: "miss", ...say.rundown(ready[0], ready[ready.length - 1], drift) });
  }
  for (const lift of ["squat", "bench", "dead"] as const) {
    const { e1rm, onFile } = row.lifts[lift];
    if (e1rm !== null && onFile !== null && e1rm >= onFile * RAISE_MAX) {
      out.push({ key: `raise-${row.id}-${lift}-${e1rm}`, athleteId: row.id, tone: "ok", max: { lift, value: e1rm }, ...say.raise(lift, onFile, e1rm) });
    }
  }
  const moved = (["squat", "bench", "dead"] as const).filter((l) => row.lifts[l].change !== null);
  const stalled = moved.find((l) => Math.abs(row.lifts[l].change!) < STALL_PCT);
  if (stalled && moved.some((l) => row.lifts[l].change! >= 1)) {
    out.push({ key: `stall-${row.id}-${stalled}`, athleteId: row.id, tone: "warn", ...say.stall(stalled, row.lifts[stalled].e1rm!) });
  }
  const lastTwo = row.rpe.slice(-2);
  if (lastTwo.every((d) => d !== null && d <= -0.5)) {
    out.push({ key: `push-${row.id}`, athleteId: row.id, tone: "ok", ...say.push(lastTwo[1]!) });
  }
  return out;
}
