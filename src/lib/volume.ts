import { rowSets } from "@/lib/compliance";
import { liftOf } from "@/lib/intensity";
import type { BlockData } from "@/lib/types";

/**
 * Sets per TARGET per week: every set written, and how many of them were done. The
 * competition lifts also count toward the muscles they train — bench toward Chest, squat
 * and deadlift toward Legs — merged with any TARGET of that name the coach already uses.
 */

export type VolumeCell = { planned: number; done: number };

export type VolumeRow = {
  target: string;
  /** Holds sets counted in from bench, squat or deadlift rows. */
  derived: boolean;
  weeks: Record<number, VolumeCell>;
  total: VolumeCell;
};

/** Names for the groups filled in, in the coach's language so they meet the coach's own targets. */
export type VolumeNames = { noTarget: string; chest: string; legs: string };

const ENGLISH: VolumeNames = { noTarget: "No target", chest: "Chest", legs: "Legs" };

export function weeklyVolume(block: Pick<BlockData, "weeks">, names: VolumeNames = ENGLISH): VolumeRow[] {
  const also = { bench: names.chest, squat: names.legs, dead: names.legs };
  const rows = new Map<string, VolumeRow>();
  const named = new Set<string>();

  const add = (name: string, week: number, sets: VolumeCell, derived: boolean) => {
    const key = name.toLowerCase();
    const row = rows.get(key) ?? { target: name, derived: false, weeks: {}, total: { planned: 0, done: 0 } };
    // The coach's own spelling of a target wins over the one filled in for a main lift.
    if (!derived && !named.has(key)) {
      named.add(key);
      row.target = name;
    }
    const cell = (row.weeks[week] ??= { planned: 0, done: 0 });
    cell.planned += sets.planned;
    cell.done += sets.done;
    row.total.planned += sets.planned;
    row.total.done += sets.done;
    row.derived ||= derived;
    rows.set(key, row);
  };

  for (const week of block.weeks) {
    for (const day of week.days) {
      if (day.rest) continue;
      for (const row of day.rows) {
        if (row.exercise.trim() === "") continue;
        const { prescribed, done } = rowSets(row);
        const sets = { planned: prescribed, done };
        add(row.target.trim() || names.noTarget, week.order, sets, false);
        const lift = liftOf(row.target);
        if (lift) add(also[lift], week.order, sets, true);
      }
    }
  }

  return [...rows.values()];
}

export type VolumeSort = { by: "target" } | { by: "week"; week: number } | { by: "total" };

/** Alphabetical by target, or by sets in a week or overall; ties stay alphabetical. */
export function sortVolume(rows: VolumeRow[], sort: VolumeSort, descending: boolean): VolumeRow[] {
  const value = (r: VolumeRow) =>
    sort.by === "week" ? (r.weeks[sort.week]?.planned ?? 0) : sort.by === "total" ? r.total.planned : 0;
  const dir = descending ? -1 : 1;
  return [...rows].sort((a, b) =>
    sort.by === "target"
      ? dir * a.target.localeCompare(b.target)
      : dir * (value(a) - value(b)) || a.target.localeCompare(b.target),
  );
}
