import type { IntensityType, Tier } from "@prisma/client";
import { dayStatus, daySets, prescribedRpe, rpeDrift } from "@/lib/compliance";
import { estimate1RM, liftOf, maxesOf, oneRepMaxFor, resolveDay } from "@/lib/intensity";
import { dateOfDay } from "@/lib/schedule";
import { topSetOf } from "@/lib/tracking";
import type { AthleteData, BlockData, RowData } from "@/lib/types";

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
  /** The phase and program the point comes from, for narrowing the chart's range. */
  blockId?: string;
  programId?: string;
};

export type LiftSeries = { lift: LiftKey; label: string; points: ProgressPoint[] };

export type ProgressBlock = {
  id?: string;
  phase: string;
  program: { id?: string; name: string };
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
          blockId: block.id,
          programId: block.program.id,
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

// --- One phase, week by week, for the Progress charts ------------------------------------

type PhaseBlock = Pick<BlockData, "startDate" | "weeks" | "squat1RM" | "bench1RM" | "dead1RM">;

function rowsOfWeek(week: BlockData["weeks"][number]): RowData[] {
  return week.days.filter((d) => !d.rest).flatMap((d) => d.rows.filter((r) => r.exercise.trim() !== ""));
}

/** Weight × reps over the sets done; a weight typed in with no sets logged counts every set. */
export function rowTonnage(row: Pick<RowData, "logs" | "actualWeight" | "sets" | "reps">): number {
  const done = (row.logs ?? []).filter((l) => l.done);
  if (done.length > 0) return done.reduce((n, l) => n + (l.weight ?? 0) * (l.reps ?? row.reps ?? 0), 0);
  return row.actualWeight === null ? 0 : row.actualWeight * (row.sets ?? 1) * (row.reps ?? 0);
}

export type StackedWeek = { week: number; parts: Record<string, number> };

/** Tonnage per week, split by main lift ("Other" for the rest) or by TARGET as written. */
export function weeklyTonnage(
  block: Pick<BlockData, "weeks">,
  by: "lift" | "target",
  names: { other: string; noTarget: string; lifts: Record<LiftKey, string> } = { other: "Other", noTarget: "No target", lifts: LIFT_LABEL },
): StackedWeek[] {
  return block.weeks.map((week) => {
    const parts: Record<string, number> = {};
    for (const row of rowsOfWeek(week)) {
      const load = rowTonnage(row);
      if (load === 0) continue;
      const lift = liftOf(row.target);
      const key = by === "lift" ? (lift ? names.lifts[lift] : names.other) : row.target.trim() || names.noTarget;
      parts[key] = Math.round((parts[key] ?? 0) + load);
    }
    return { week: week.order, parts };
  });
}

export type RpeWeek = { week: number; planned: number | null; actual: number | null; n: number };

/** Prescribed against logged RPE per week, over the rows of one lift (or all) that have both. */
export function rpeByWeek(block: Pick<BlockData, "weeks">, lift: LiftKey | "all"): RpeWeek[] {
  const mean = (xs: number[]) => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10);
  return block.weeks.map((week) => {
    const planned: number[] = [];
    const actual: number[] = [];
    for (const row of rowsOfWeek(week)) {
      if (lift !== "all" && liftOf(row.target) !== lift) continue;
      const p = prescribedRpe(row);
      if (p === null || row.performedRpe === null) continue;
      planned.push(p);
      actual.push(row.performedRpe);
    }
    return { week: week.order, planned: mean(planned), actual: mean(actual), n: planned.length };
  });
}

export type ComplianceWeek = { week: number; done: number; due: number; pct: number | null; missed: number };

/** Sets done of the sets due so far, per week — a session still to come isn't due yet. */
export function complianceByWeek(block: PhaseBlock, today: string): ComplianceWeek[] {
  return block.weeks.map((week) => {
    let done = 0;
    let due = 0;
    let missed = 0;
    for (const day of week.days) {
      if (day.rest) continue;
      const sets = daySets(day.rows);
      if (sets.prescribed === 0) continue;
      const ymd = dateOfDay(block.startDate, week.order, day.index);
      if (ymd > today && sets.done === 0) continue;
      done += sets.done;
      due += sets.prescribed;
      if (dayStatus(ymd, today, sets, true) === "missed") missed++;
    }
    return { week: week.order, done, due, pct: due === 0 ? null : Math.round((done / due) * 100), missed };
  });
}

/** %1RM bands, lightest first. */
export const ZONES = [
  { key: "<70%", below: 0.7 },
  { key: "70–80%", below: 0.8 },
  { key: "80–90%", below: 0.9 },
  { key: "90%+", below: Infinity },
] as const;

/**
 * Sets done per week in each %1RM band, against the max each row is written off (a
 * variation's is lower). Rows with no max to measure against are left out.
 */
export function intensityZones(block: PhaseBlock, athlete: AthleteData, lift: LiftKey | "all"): StackedWeek[] {
  const maxes = maxesOf(block, athlete);
  return block.weeks.map((week) => {
    const parts: Record<string, number> = Object.fromEntries(ZONES.map((z) => [z.key, 0]));
    for (const row of rowsOfWeek(week)) {
      if (lift !== "all" && liftOf(row.target) !== lift) continue;
      const max = oneRepMaxFor(row.target, row.tier, maxes);
      if (max === null || max <= 0) continue;
      const logged = (row.logs ?? []).filter((l) => l.done && l.weight !== null).map((l) => l.weight as number);
      const weights =
        logged.length > 0
          ? logged
          : row.actualWeight === null
            ? []
            : Array.from({ length: Math.max(1, row.sets ?? 1) }, () => row.actualWeight as number);
      for (const w of weights) {
        const zone = ZONES.find((z) => w / max < z.below) ?? ZONES[ZONES.length - 1];
        parts[zone.key]++;
      }
    }
    return { week: week.order, parts };
  });
}

export type LiftWeek = {
  week: number;
  top: { weight: number; reps: number | null; rpe: number | null } | null;
  e1rm: number | null;
  rpeDelta: number | null;
  setsDone: number;
  setsPrescribed: number;
  tonnage: number;
};

/**
 * One main lift through the phase: its heaviest competition-lift set each week and the 1RM
 * it implies, how far RPE ran from plan, and the work done on every row of that lift.
 */
export function liftWeekTable(block: PhaseBlock, athlete: AthleteData, lift: LiftKey): LiftWeek[] {
  return block.weeks.map((week) => {
    const rows = rowsOfWeek(week).filter((r) => liftOf(r.target) === lift);
    let top: LiftWeek["top"] = null;
    let e1rm: number | null = null;
    for (const row of rows) {
      if (row.tier !== "PRIMARY") continue;
      const set = topSetOf(row);
      if (!set) continue;
      const estimate = estimate1RM(set.weight, set.reps, set.rpe, athlete.unit);
      if (estimate !== null && (e1rm === null || estimate > e1rm)) e1rm = estimate;
      if (!top || set.weight > top.weight) top = set;
    }
    const sets = daySets(rows);
    return {
      week: week.order,
      top,
      e1rm,
      rpeDelta: rpeDrift(rows).mean,
      setsDone: sets.done,
      setsPrescribed: sets.prescribed,
      tonnage: Math.round(rows.reduce((n, r) => n + rowTonnage(r), 0)),
    };
  });
}
