import type { IntensityType } from "@prisma/client";

/**
 * How closely an athlete is following the plan, worked out from what is already stored:
 * sets ticked off in the athlete app, or a weight typed into Tracking by the coach.
 * Nothing here reads the database, so Overview and Tracking share one definition.
 */

export type ComplianceRow = {
  exercise: string;
  sets: number | null;
  intensityType: IntensityType;
  intensity: number | null;
  intensityMax: number | null;
  actualWeight: number | null;
  performedRpe: number | null;
  logs?: { done: boolean }[];
};

/** A row's prescribed sets, and how many of them were done. Extras don't push it past 100%. */
export function rowSets(row: Pick<ComplianceRow, "sets" | "actualWeight" | "logs">): { prescribed: number; done: number } {
  const prescribed = Math.max(1, row.sets ?? 1);
  const ticked = row.logs?.filter((l) => l.done).length ?? 0;
  // A weight typed in on the desktop, with no sets logged, counts the row as done.
  const done = ticked > 0 ? ticked : row.actualWeight !== null ? prescribed : 0;
  return { prescribed, done: Math.min(done, prescribed) };
}

/** A day's prescribed and done sets, over the rows that name an exercise. */
export function daySets(rows: Pick<ComplianceRow, "exercise" | "sets" | "actualWeight" | "logs">[]): { prescribed: number; done: number } {
  let prescribed = 0;
  let done = 0;
  for (const row of rows) {
    if (row.exercise.trim() === "") continue;
    const s = rowSets(row);
    prescribed += s.prescribed;
    done += s.done;
  }
  return { prescribed, done };
}

export type DayStatus = "done" | "partial" | "missed" | "today" | "upcoming" | "rest" | "none";

/**
 * One calendar day for one athlete. `session` is the day's sets when a training day falls
 * on it; `covered` says whether any phase runs over the date, which is what tells a rest
 * day apart from a day with no program at all.
 */
export function dayStatus(
  ymd: string,
  today: string,
  session: { prescribed: number; done: number } | null,
  covered: boolean,
): DayStatus {
  if (!session) return covered ? "rest" : "none";
  if (session.done > 0 && session.done >= session.prescribed) return "done";
  if (session.done > 0) return "partial";
  if (ymd < today) return "missed";
  return ymd === today ? "today" : "upcoming";
}

/** Share of the sets due so far that were done, as a whole percentage; null when nothing was due. */
export function completionPct(days: { prescribed: number; done: number }[]): number | null {
  const prescribed = days.reduce((n, d) => n + d.prescribed, 0);
  if (prescribed === 0) return null;
  return Math.round((days.reduce((n, d) => n + d.done, 0) / prescribed) * 100);
}

/** The RPE a row asks for, when it asks in RPE or RIR; the top of an RPE range. */
export function prescribedRpe(row: Pick<ComplianceRow, "intensityType" | "intensity" | "intensityMax">): number | null {
  if (row.intensity === null) return null;
  if (row.intensityType === "RPE") return row.intensityMax ?? row.intensity;
  if (row.intensityType === "RIR") return 10 - row.intensity;
  return null;
}

/** Logged minus prescribed RPE, when both are there. Positive means it felt heavier than planned. */
export function rpeDelta(row: Pick<ComplianceRow, "intensityType" | "intensity" | "intensityMax" | "performedRpe">): number | null {
  const planned = prescribedRpe(row);
  if (planned === null || row.performedRpe === null) return null;
  return row.performedRpe - planned;
}

/** Mean RPE delta over some rows, to one decimal, with how many rows it rests on. */
export function rpeDrift(rows: Parameters<typeof rpeDelta>[0][]): { mean: number | null; n: number } {
  const deltas = rows.map(rpeDelta).filter((d): d is number => d !== null);
  if (deltas.length === 0) return { mean: null, n: 0 };
  return { mean: Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10, n: deltas.length };
}

/** RPE this far above the plan, on average, is worth the coach's attention. */
export const DRIFT_WARN = 1;
/** …but only once there are enough logged rows behind it. */
export const DRIFT_MIN_ROWS = 3;

/** How far under the target weight a logged set can be before it counts as off plan. */
export const UNDER_TARGET = 0.05;
/** How many RPE points over the prescription counts as off plan. */
export const RPE_OVER = 1;

export type OffPlanReason = "missed" | "under" | "rpe";

export type OffPlan = {
  /** "miss" is a red edge, "warn" an amber one. */
  level: "miss" | "warn";
  reasons: OffPlanReason[];
};

/**
 * Whether one row went other than planned: not done though its day has passed, done more
 * than 5% under the target weight, or logged at least one RPE above the prescription.
 */
export function offPlan(row: ComplianceRow, target: number | null, past: boolean): OffPlan | null {
  if (row.exercise.trim() === "") return null;
  const { done } = rowSets(row);
  if (done === 0) return past ? { level: "miss", reasons: ["missed"] } : null;

  const reasons: OffPlanReason[] = [];
  if (row.actualWeight !== null && target !== null && target > 0 && row.actualWeight < target * (1 - UNDER_TARGET)) {
    reasons.push("under");
  }
  const delta = rpeDelta(row);
  if (delta !== null && delta >= RPE_OVER) reasons.push("rpe");
  return reasons.length > 0 ? { level: "warn", reasons } : null;
}
