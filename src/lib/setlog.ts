/** One set as the athlete logged it. */
export type SetLogData = {
  id: string;
  setIndex: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  /** Reps in reserve, when effort was logged that way; a set has one or the other. */
  rir: number | null;
  done: boolean;
  /** Flagged by the athlete as a personal record. */
  pr: boolean;
  loggedAt: string;
};

type Effort = { rpe: number | null; rir?: number | null };

/** A set's effort as an RPE, for the maths — an RIR of 2 is an RPE of 8. */
export function rpeOf(log: Effort): number | null {
  if (log.rpe !== null) return log.rpe;
  return log.rir === null || log.rir === undefined ? null : 10 - log.rir;
}

/** "@8" or "RIR 2" — the effort as it was logged. */
export function formatEffort(log: Effort): string {
  if (log.rpe !== null) return `@${log.rpe}`;
  return log.rir === null || log.rir === undefined ? "" : `RIR ${log.rir}`;
}

/**
 * What a row's single "logged" column should say once sets are logged: the heaviest
 * finished set, with its RPE. Tracking, e1RMs, progress charts and exports all read the
 * row, so keeping it in step means none of them has to know about sets.
 */
export function rowActuals(
  logs: ({ weight: number | null; done: boolean } & Effort)[],
): { actualWeight: number | null; performedRpe: number | null } {
  let top: { weight: number; rpe: number | null } | null = null;
  for (const log of logs) {
    if (!log.done || log.weight === null) continue;
    // An RIR counts as its RPE here: the row's one column feeds the e1RM estimates.
    const rpe = rpeOf(log);
    if (!top || log.weight > top.weight || (log.weight === top.weight && (rpe ?? 0) > (top.rpe ?? 0))) {
      top = { weight: log.weight, rpe };
    }
  }
  return { actualWeight: top?.weight ?? null, performedRpe: top?.rpe ?? null };
}

/** "done", "partial" or "none" — how much of a day's prescribed sets got checked off. */
export function completion(done: number, prescribed: number): "done" | "partial" | "none" {
  if (done === 0) return "none";
  return done >= prescribed ? "done" : "partial";
}

/** "180×3 @8" — a logged set in the space of a chip. */
export function formatSet(log: { weight: number | null; reps: number | null } & Effort): string {
  const w = log.weight ?? "—";
  const r = log.reps === null ? "" : `×${log.reps}`;
  const effort = formatEffort(log);
  const e = effort === "" ? "" : ` ${effort}`;
  return `${w}${r}${e}`;
}
