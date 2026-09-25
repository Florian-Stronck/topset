import type { IntensityType, Tier } from "@prisma/client";
import { estimate1RM, liftOf, maxesOf, resolveDay } from "@/lib/intensity";
import type { AthleteData } from "@/lib/types";

export type LiftKey = "squat" | "bench" | "dead";

export const LIFT_ORDER: LiftKey[] = ["squat", "bench", "dead"];

export const LIFT_LABEL: Record<LiftKey, string> = {
  squat: "Squat",
  bench: "Bench",
  dead: "Deadlift",
};

/**
 * Categorical hues, in fixed order, validated against the dark chart surface (#121216):
 * lightness band, chroma floor, CVD separation, normal-vision floor and contrast all pass.
 * They are assigned per lift and never cycled — filtering a lift out repaints nothing.
 */
export const LIFT_COLOR: Record<LiftKey, string> = {
  squat: "#e5365a",
  bench: "#3b8fd4",
  dead: "#b87a2e",
};

export type ProgressPoint = {
  /** Week start, as milliseconds — the x position. */
  t: number;
  date: string;
  value: number;
  week: number;
  block: string;
};

export type LiftSeries = { lift: LiftKey; label: string; points: ProgressPoint[] };

export type ProgressBlock = {
  phase: string;
  program: { name: string };
  startDate: Date;
  squat1RM: number | null;
  bench1RM: number | null;
  dead1RM: number | null;
  weeks: {
    order: number;
    days: {
      rest: boolean;
      rows: {
        id: string;
        tier: Tier;
        target: string;
        exercise: string;
        sets: number | null;
        reps: number | null;
        intensityType: IntensityType;
        intensity: number | null;
        intensityMax: number | null;
        rampStep: number | null;
        actualWeight: number | null;
        performedRpe: number | null;
      }[];
    }[];
  }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function weekStart(start: Date, week: number) {
  const midnight = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return midnight + (week - 1) * 7 * DAY_MS;
}

/**
 * The heaviest single number worth plotting for each lift, each week, across every
 * program: either the top prescribed target weight, or the best 1RM the logged work
 * implies. Only PRIMARY rows count — a variation is trained off a lower max, so putting
 * it on the same line would read as a dip that never happened.
 */
export function liftProgress(
  blocks: ProgressBlock[],
  athlete: AthleteData,
  mode: "prescribed" | "estimated",
): LiftSeries[] {
  const points: Record<LiftKey, ProgressPoint[]> = { squat: [], bench: [], dead: [] };

  for (const block of blocks) {
    const maxes = maxesOf(block, athlete);

    for (const { order: week, days } of block.weeks) {
      const best: Partial<Record<LiftKey, number>> = {};

      for (const day of days) {
        if (day.rest) continue;
        const resolved = mode === "prescribed" ? resolveDay(day.rows, maxes) : null;

        for (const row of day.rows) {
          if (row.tier !== "PRIMARY" || row.exercise.trim() === "") continue;
          const lift = liftOf(row.target);
          if (!lift) continue;

          const value =
            mode === "prescribed"
              ? (resolved?.get(row.id)?.weight ?? null)
              : row.actualWeight === null
                ? null
                : estimate1RM(row.actualWeight, row.reps, row.performedRpe, athlete.unit);

          if (value === null) continue;
          if (best[lift] === undefined || value > best[lift]) best[lift] = value;
        }
      }

      const t = weekStart(block.startDate, week);
      for (const lift of LIFT_ORDER) {
        const value = best[lift];
        if (value === undefined) continue;
        points[lift].push({
          t,
          date: new Date(t).toISOString().slice(0, 10),
          value,
          week,
          block: `${block.program.name} · ${block.phase}`,
        });
      }
    }
  }

  return LIFT_ORDER.map((lift) => ({
    lift,
    label: LIFT_LABEL[lift],
    points: points[lift].sort((a, b) => a.t - b.t),
  }));
}
