import { estimate1RM, formatPrescription, maxesOf, resolveDay } from "@/lib/intensity";
import type { ProgressBlock } from "@/lib/progress";
import { dateOfDay } from "@/lib/schedule";
import type { AthleteData } from "@/lib/types";

/**
 * Every time an exercise was logged, across every program: the day, what was asked, the
 * top set done and what it implies as a 1RM. Any exercise counts — variations and
 * accessories too — keyed by its name as written, whatever its case or spacing.
 */

export type ExerciseLog = {
  ymd: string;
  where: string;
  week: number;
  prescribed: string;
  target: number | null;
  weight: number;
  reps: number | null;
  rpe: number | null;
  e1rm: number | null;
};

export type ExerciseHistory = { name: string; logs: ExerciseLog[] };

type ProgressDay = ProgressBlock["weeks"][number]["days"][number];
type HistoryBlock = Omit<ProgressBlock, "weeks"> & { weeks: { order: number; days: (ProgressDay & { index: number })[] }[] };

const keyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function exerciseHistory(blocks: HistoryBlock[], athlete: AthleteData): ExerciseHistory[] {
  const out = new Map<string, ExerciseHistory>();

  for (const block of blocks) {
    const maxes = maxesOf(block, athlete);
    for (const week of block.weeks) {
      for (const day of week.days) {
        if (day.rest) continue;
        const resolved = resolveDay(day.rows, maxes);
        for (const row of day.rows) {
          if (row.exercise.trim() === "" || row.actualWeight === null) continue;
          const key = keyOf(row.exercise);
          const entry = out.get(key) ?? { name: row.exercise.trim().replace(/\s+/g, " "), logs: [] };
          entry.logs.push({
            ymd: dateOfDay(block.startDate, week.order, day.index),
            where: `${block.program.name} · ${block.phase}`,
            week: week.order,
            prescribed: `${row.sets ?? "—"} × ${row.reps ?? "—"} @ ${formatPrescription(row, athlete.unit)}`,
            target: resolved.get(row.id)?.weight ?? null,
            weight: row.actualWeight,
            reps: row.reps,
            rpe: row.performedRpe,
            e1rm: row.reps === null ? null : estimate1RM(row.actualWeight, row.reps, row.performedRpe, athlete.unit),
          });
          out.set(key, entry);
        }
      }
    }
  }

  // Most logged first: the lifts the athlete actually trains lead the picker.
  return [...out.values()]
    .map((h) => ({ ...h, logs: h.logs.sort((a, b) => a.ymd.localeCompare(b.ymd)) }))
    .sort((a, b) => b.logs.length - a.logs.length || a.name.localeCompare(b.name));
}
