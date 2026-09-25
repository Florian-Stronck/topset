import { daySets, rpeDrift } from "@/lib/compliance";
import { estimate1RM, liftOf } from "@/lib/intensity";
import type { AthleteData, BlockData, RowData } from "@/lib/types";
import { activeSettings } from "@/lib/settings";

export type WeekStat = {
  week: number;
  /** Rows carrying a prescription that week. */
  prescribed: number;
  /** Of those, how many have a logged weight. */
  logged: number;
  /** sets × reps × logged weight, summed. */
  tonnage: number;
  /** Mean (performed RPE − prescribed RPE); positive means it ran heavier than planned. */
  rpeDelta: number | null;
  /** Sets done of the sets prescribed, for the week's completion bar. */
  setsDone: number;
  setsPrescribed: number;
};

export type LiftBest = {
  lift: "squat" | "bench" | "dead";
  label: string;
  exercise: string;
  week: number;
  weight: number;
  reps: number;
  rpe: number | null;
  e1rm: number;
  /** The 1RM currently on file, for the comparison. */
  onFile: number | null;
  /** Beats the 1RM on file, by the coach's definition of a PR. */
  pr: boolean;
};

/**
 * A PR is either an estimated 1RM above the one on file, or — stricter — a weight
 * actually lifted above it, depending on the coach's setting.
 */
export function isPr(best: { e1rm: number; weight: number }, onFile: number | null): boolean {
  if (onFile === null) return false;
  return activeSettings().pr.basis === "weight" ? best.weight > onFile : best.e1rm > onFile;
}

const LIFT_LABEL = { squat: "Squat", bench: "Bench", dead: "Deadlift" } as const;

function programmed(row: RowData) {
  return row.exercise.trim() !== "";
}

export function weekStats(block: BlockData): WeekStat[] {
  return block.weeks.map((week) => {
    let prescribed = 0;
    let logged = 0;
    let tonnage = 0;
    const compared: RowData[] = [];

    for (const day of week.days) {
      if (day.rest) continue;
      for (const row of day.rows) {
        if (!programmed(row)) continue;

        if (row.intensity !== null || row.sets !== null) prescribed++;

        if (row.actualWeight !== null) {
          logged++;
          tonnage += (row.sets ?? 0) * (row.reps ?? 0) * row.actualWeight;
        }

        compared.push(row);
      }
    }

    // An RPE or RIR prescription is compared like for like; nothing else says how hard.
    const drift = rpeDrift(compared);
    const sets = daySets(week.days.filter((d) => !d.rest).flatMap((d) => d.rows));

    return {
      week: week.order,
      prescribed,
      logged,
      tonnage: Math.round(tonnage),
      rpeDelta: drift.mean,
      setsDone: sets.done,
      setsPrescribed: sets.prescribed,
    };
  });
}

/**
 * Best estimated 1RM per lift from what was actually logged. Only PRIMARY rows count:
 * a variation is trained off a lower max, so reading a competition 1RM out of a paused
 * squat would quietly understate the athlete.
 */
export function bestEstimates(block: BlockData, athlete: AthleteData): LiftBest[] {
  const best = new Map<LiftBest["lift"], LiftBest>();
  const onFile = {
    squat: athlete.squat1RM,
    bench: athlete.bench1RM,
    dead: athlete.dead1RM,
  };

  for (const week of block.weeks) {
    for (const day of week.days) {
      if (day.rest) continue;
      for (const row of day.rows) {
        if (!programmed(row) || row.tier !== "PRIMARY") continue;
        const lift = liftOf(row.target);
        if (!lift) continue;

        if (row.actualWeight === null || row.reps === null) continue;
        const e1rm = estimate1RM(row.actualWeight, row.reps, row.performedRpe, athlete.unit);
        if (e1rm === null) continue;

        const current = best.get(lift);
        if (current && current.e1rm >= e1rm) continue;

        best.set(lift, {
          lift,
          label: LIFT_LABEL[lift],
          exercise: row.exercise,
          week: week.order,
          weight: row.actualWeight,
          reps: row.reps,
          rpe: row.performedRpe,
          e1rm,
          onFile: onFile[lift],
          pr: isPr({ e1rm, weight: row.actualWeight }, onFile[lift]),
        });
      }
    }
  }

  return [...best.values()].sort((a, b) => a.label.localeCompare(b.label));
}
