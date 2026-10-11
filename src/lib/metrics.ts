import { dailyWeights, rollingAverage, type BodyweightEntry } from "@/lib/bodyweight";
import { readinessOf, scaleScore, type CheckinAnswerData, type CheckinQuestionData } from "@/lib/checkins";
import { daySets, prescribedRpe, rowSets, rpeDelta } from "@/lib/compliance";
import { weekStartOf } from "@/lib/dates";
import { keyOf, type HistoryBlock } from "@/lib/exercise-history";
import { t } from "@/lib/i18n";
import type { InjuryData } from "@/lib/injuries";
import { estimate1RM, liftOf, maxesOf, oneRepMaxFor, rpeTableFor } from "@/lib/intensity";
import type { NutritionEntry, TargetSpan } from "@/lib/nutrition";
import { LIFT_COLOR, LIFT_LABEL, LIFT_ORDER, rowTonnage, ZONES } from "@/lib/progress";
import { addDays, NO_MOVES, sessionDate } from "@/lib/schedule";
import { topSetOf } from "@/lib/tracking";
import type { AthleteData, RowData } from "@/lib/types";

/**
 * Everything Tracking records, as one dated series per measure, so any of them can be
 * charted against any other on the same calendar. Built on the server from what the page
 * already loads; the custom chart tabs only bucket and draw.
 *
 * Ids name things by what they are, not by database id — `q:sleep`, `e1rm-ex:pause squat`,
 * `tonnage-t:back` — so a chart the coach builds once reads the same measure on every
 * athlete who has it.
 */

export type Agg = "avg" | "sum" | "max" | "min" | "last";
export const AGGS: Agg[] = ["avg", "sum", "max", "min", "last"];

export type MetricGroup = "Strength" | "Exercises" | "Training load" | "Body" | "Nutrition" | "Check-ins" | "Injuries";
export const METRIC_GROUPS: MetricGroup[] = ["Strength", "Exercises", "Training load", "Body", "Nutrition", "Check-ins", "Injuries"];

export type MetricDef = { id: string; label: string; unit: string; group: MetricGroup; agg: Agg; color: string };

/** `[YYYY-MM-DD, value]`, oldest first — tuples keep the page small. */
export type Point = [string, number];

export type Metrics = { defs: MetricDef[]; points: Record<string, Point[]> };

type Log = { weight: number | null; reps: number | null; rpe: number | null; rir: number | null; done: boolean; pr: boolean };
type HistoryRow = HistoryBlock["weeks"][number]["days"][number]["rows"][number];
export type MetricBlock = Omit<HistoryBlock, "weeks"> & {
  weeks: { order: number; days: { id: string; index: number; rest: boolean; rows: (HistoryRow & { logs?: Log[] })[] }[] }[];
};

export type MetricInput = {
  phases: MetricBlock[];
  athlete: AthleteData;
  bodyweights: BodyweightEntry[];
  nutrition: NutritionEntry[];
  targets: TargetSpan[];
  questions: CheckinQuestionData[];
  answers: CheckinAnswerData[];
  injuries: InjuryData[];
  moves?: ReadonlyMap<string, string>;
  today: string;
};

/** A fixed hue per slot, the same order the lifts use, for measures with no colour of their own. */
export const PALETTE = ["#e5365a", "#3b8fd4", "#b87a2e", "#3aa676", "#9b6bd6", "#d4633b", "#2fa3a3", "#c2569b"];

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function computeMetrics(input: MetricInput): Metrics {
  const { athlete, today, moves = NO_MOVES } = input;
  const defs = new Map<string, MetricDef>();
  // Per metric, per day: the values that fell on it, reduced once everything is in.
  const raw = new Map<string, Map<string, number[]>>();
  const reduceDay = new Map<string, Agg>();

  const def = (id: string, label: string, unit: string, group: MetricGroup, agg: Agg, color?: string, perDay: Agg = agg) => {
    if (!defs.has(id)) defs.set(id, { id, label, unit, group, agg, color: color ?? PALETTE[defs.size % PALETTE.length] });
    reduceDay.set(id, perDay);
  };
  const put = (id: string, day: string, value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    const byDay = raw.get(id) ?? new Map<string, number[]>();
    byDay.set(day, [...(byDay.get(day) ?? []), value]);
    raw.set(id, byDay);
  };

  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const table = rpeTableFor(athlete);

  // --- Training ---------------------------------------------------------------------
  def("tonnage", t("Tonnage"), unit, "Training load", "sum");
  def("sets-done", t("Sets done"), t("sets"), "Training load", "sum");
  def("sets-due", t("Sets planned"), t("sets"), "Training load", "sum");
  def("compliance", t("Compliance"), "%", "Training load", "avg");
  def("sessions", t("Sessions trained"), "", "Training load", "sum");
  def("rpe-logged", t("Logged RPE"), "RPE", "Training load", "avg", undefined, "avg");
  def("rpe-planned", t("Planned RPE"), "RPE", "Training load", "avg", undefined, "avg");
  def("rpe-drift", t("RPE vs plan"), "RPE", "Training load", "avg", undefined, "avg");
  def("prs", t("PRs flagged"), "", "Strength", "sum");
  for (const z of ZONES) def(`zone:${z.key}`, t("Sets at {zone} of 1RM", { zone: z.key }), t("sets"), "Training load", "sum");
  for (const lift of LIFT_ORDER) {
    const name = t(LIFT_LABEL[lift]);
    def(`e1rm:${lift}`, t("{lift} e1RM", { lift: name }), unit, "Strength", "max", LIFT_COLOR[lift]);
    def(`top:${lift}`, t("{lift} top set", { lift: name }), unit, "Strength", "max", LIFT_COLOR[lift]);
    def(`tonnage:${lift}`, t("{lift} tonnage", { lift: name }), unit, "Training load", "sum", LIFT_COLOR[lift]);
  }

  for (const block of input.phases) {
    const maxes = maxesOf(block, athlete);
    for (const week of block.weeks) {
      for (const day of week.days) {
        if (day.rest) continue;
        const rows = day.rows.filter((r) => r.exercise.trim() !== "");
        if (rows.length === 0) continue;
        const ymd = sessionDate(block.startDate, week.order, day, moves);
        const sets = daySets(rows);
        const past = ymd <= today;
        if (past || sets.done > 0) {
          put("sets-due", ymd, sets.prescribed);
          put("sets-done", ymd, sets.done);
          put("sessions", ymd, sets.done > 0 ? 1 : 0);
          if (sets.prescribed > 0) put("compliance", ymd, Math.round((sets.done / sets.prescribed) * 100));
        }
        // The shared helpers type a set as the phone sends it; they only read weight, reps, effort and done.
        for (const row of rows as (HistoryRow & Pick<RowData, "logs">)[]) {
          const lift = liftOf(row.target);
          const done = rowSets(row).done;
          if (done === 0) continue;
          const tons = rowTonnage(row);
          put("tonnage", ymd, tons);
          if (lift) put(`tonnage:${lift}`, ymd, tons);
          const target = row.target.trim();
          if (target) {
            def(`tonnage-t:${keyOf(target)}`, t("{target} tonnage", { target }), unit, "Training load", "sum");
            def(`sets-t:${keyOf(target)}`, t("{target} sets", { target }), t("sets"), "Training load", "sum");
            put(`tonnage-t:${keyOf(target)}`, ymd, tons);
            put(`sets-t:${keyOf(target)}`, ymd, done);
          }
          put("rpe-planned", ymd, prescribedRpe(row));
          put("rpe-logged", ymd, row.performedRpe);
          put("rpe-drift", ymd, rpeDelta(row));
          put("prs", ymd, (row.logs ?? []).filter((l) => l.done && l.pr).length);

          const top = topSetOf(row);
          if (top) {
            const e1rm = top.reps === null ? null : estimate1RM(top.weight, top.reps, top.rpe, athlete.unit, table);
            const ex = keyOf(row.exercise);
            const name = row.exercise.trim().replace(/\s+/g, " ");
            def(`top-ex:${ex}`, t("{exercise} top set", { exercise: name }), unit, "Exercises", "max");
            def(`e1rm-ex:${ex}`, t("{exercise} e1RM", { exercise: name }), unit, "Exercises", "max");
            put(`top-ex:${ex}`, ymd, top.weight);
            put(`e1rm-ex:${ex}`, ymd, e1rm);
            // The competition lifts' lines count only the competition lift itself, as Progress does.
            if (lift && row.tier === "PRIMARY") {
              put(`top:${lift}`, ymd, top.weight);
              put(`e1rm:${lift}`, ymd, e1rm);
            }
          }

          const max = oneRepMaxFor(row.target, row.tier, maxes, row.exercise);
          if (max && max > 0) {
            const logged = (row.logs ?? []).filter((l) => l.done && l.weight !== null).map((l) => l.weight as number);
            const weights = logged.length > 0 ? logged : row.actualWeight === null ? [] : Array.from({ length: done }, () => row.actualWeight as number);
            for (const w of weights) {
              const zone = ZONES.find((z) => w / max < z.below) ?? ZONES[ZONES.length - 1];
              put(`zone:${zone.key}`, ymd, 1);
            }
          }
        }
      }
    }
  }

  // --- Body ---------------------------------------------------------------------------
  def("bw", t("Bodyweight"), unit, "Body", "avg", "#3b8fd4", "last");
  def("bw-avg7", t("Bodyweight, 7-day average"), unit, "Body", "last", "#9b6bd6", "last");
  const daily = dailyWeights(input.bodyweights);
  for (const d of daily) put("bw", d.day, d.weight);
  for (const d of rollingAverage(daily)) put("bw-avg7", d.day, d.weight);

  // --- Nutrition ------------------------------------------------------------------------
  const NUTRIENTS = [
    ["kcal", "Calories", "kcal", "#d4633b"],
    ["protein", "Protein", "g", "#e5365a"],
    ["carbs", "Carbs", "g", "#b87a2e"],
    ["fat", "Fat", "g", "#3aa676"],
  ] as const;
  for (const [key, label, u, color] of NUTRIENTS) {
    def(key, t(label), u, "Nutrition", "avg", color, "last");
    def(`${key}-target`, t("{nutrient} target", { nutrient: t(label) }), u, "Nutrition", "avg", color, "last");
    for (const e of input.nutrition) put(key, e.day, e[key]);
    for (const span of input.targets) {
      const value = span.target[key];
      if (value === null) continue;
      for (let d = span.from; d <= span.to && d <= today; d = addDays(d, 1)) put(`${key}-target`, d, value);
    }
  }

  // --- Check-ins ------------------------------------------------------------------------
  def("readiness", t("Readiness"), "1–5", "Check-ins", "avg", "#3b8fd4", "last");
  const byDay = new Map<string, CheckinAnswerData[]>();
  for (const a of input.answers) byDay.set(a.day, [...(byDay.get(a.day) ?? []), a]);
  for (const [day, answers] of byDay) put("readiness", day, readinessOf(input.questions, answers).score);
  const questions = new Map(input.questions.map((q) => [q.id, q]));
  for (const q of input.questions) {
    if (q.kind !== "NUMBER" && q.kind !== "SCALE" && q.kind !== "YESNO") continue;
    const u = q.kind === "SCALE" ? `${q.config.min ?? 1}–${q.config.max ?? 5}` : q.kind === "YESNO" ? "%" : (q.config.unit ?? "");
    def(`q:${keyOf(q.label)}`, q.label, u, "Check-ins", "avg", undefined, "last");
  }
  for (const a of input.answers) {
    const q = questions.get(a.questionId);
    if (!q || !defs.has(`q:${keyOf(q.label)}`)) continue;
    const value = q.kind === "YESNO" ? (a.value === "yes" ? 100 : a.value === "no" ? 0 : null) : a.value === null ? null : Number(a.value);
    put(`q:${keyOf(q.label)}`, a.day, value);
  }
  // A scale's own 1–5 reading too, for laying questions on different scales over each other.
  for (const q of input.questions) {
    if (q.kind !== "SCALE") continue;
    def(`q15:${keyOf(q.label)}`, t("{question} (1–5)", { question: q.label }), "1–5", "Check-ins", "avg", undefined, "last");
  }
  for (const a of input.answers) {
    const q = questions.get(a.questionId);
    if (q?.kind === "SCALE") put(`q15:${keyOf(q.label)}`, a.day, scaleScore(q, a.value));
  }

  // --- Injuries ---------------------------------------------------------------------------
  def("injuries", t("Active injuries"), "", "Injuries", "max", "#d4633b", "last");
  def("injury-severity", t("Worst injury severity"), "1–5", "Injuries", "max", "#e5365a", "last");
  if (input.injuries.length > 0) {
    const first = input.injuries.reduce((m, i) => (i.day < m ? i.day : m), today);
    for (let d = first; d <= today; d = addDays(d, 1)) {
      const on = input.injuries.filter((i) => i.day <= d && (i.endDay === null || i.endDay > d));
      put("injuries", d, on.length);
      put("injury-severity", d, on.length === 0 ? 0 : Math.max(...on.map((i) => i.severity)));
    }
  }

  const points: Record<string, Point[]> = {};
  for (const [id, byDay] of raw) {
    points[id] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, values]) => [day, round(reduce(values, reduceDay.get(id) ?? "sum"), 2)]);
  }
  // Only what the athlete has logged; a chart asking for something else draws it empty.
  return { defs: [...defs.values()].filter((d) => d.id in points), points };
}

export function reduce(values: number[], agg: Agg): number {
  switch (agg) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "last":
      return values[values.length - 1];
    default:
      return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

/**
 * A series on the calendar from `from` to `to`, one value per day or per week (weeks start
 * on `weekStart`, 0 = Monday); null where nothing was logged.
 */
export function bucket(points: Point[], by: "day" | "week", agg: Agg, from: string, to: string, weekStart = 0): { key: string; value: number | null }[] {
  const keyOf = (day: string) => (by === "week" ? weekStartOf(day, weekStart) : day);
  const groups = new Map<string, number[]>();
  for (const [day, value] of points) {
    if (day < from || day > to) continue;
    const k = keyOf(day);
    groups.set(k, [...(groups.get(k) ?? []), value]);
  }
  const out: { key: string; value: number | null }[] = [];
  for (let d = keyOf(from); d <= to; d = addDays(d, by === "week" ? 7 : 1)) {
    const values = groups.get(d);
    out.push({ key: d, value: values ? round(reduce(values, agg), 1) : null });
  }
  return out;
}

/** Least-squares straight line through the points, with how well it fits (r², 0–1); null under two distinct x. */
export function fitLine(points: [number, number][]): { slope: number; intercept: number; r2: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}
