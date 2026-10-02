import type { IntensityType, ProgField, ProgOp, Unit } from "@prisma/client";
import { roundToIncrement } from "@/lib/intensity";
import { t } from "@/lib/i18n";

export type Rule = {
  id: string;
  order: number;
  field: ProgField;
  op: ProgOp;
  amount: number;
  everyWeeks: number;
  startWeek: number;
  endWeek: number | null;
  enabled: boolean;
};

export type BaseValues = {
  sets: number | null;
  reps: number | null;
  /** A rep range's top; moves with the bottom, keeping the range's width. */
  repsMax?: number | null;
  intensity: number | null;
  intensityMax: number | null;
  intensityType: IntensityType;
  /** Seconds per set; absent on rows made before timed sets existed. */
  duration?: number | null;
  /** A weight typed over the intensity; what a LOAD rule moves when there is one. */
  load?: number | null;
};

/**
 * How many times a rule has fired by the given week. "+1 rep every week from
 * week 2" has fired twice by week 3, so progressions stay cumulative rather
 * than re-applying a flat offset.
 */
export function applications(rule: Rule, week: number): number {
  if (week < rule.startWeek) return 0;
  const last = rule.endWeek === null ? week : Math.min(week, rule.endWeek);
  if (last < rule.startWeek) return 0;
  return Math.floor((last - rule.startWeek) / Math.max(1, rule.everyWeeks)) + 1;
}

function step(value: number, rule: Rule, times: number): number {
  return rule.op === "MULTIPLY" ? value * rule.amount ** times : value + rule.amount * times;
}

function roundIntensity(value: number, type: IntensityType, unit: Unit): number {
  if (type === "WEIGHT" || type === "RANGE") return roundToIncrement(value, unit);
  const rounded = Math.round(value * 2) / 2;
  if (type === "RPE") return Math.min(10, Math.max(1, rounded));
  if (type === "RIR") return Math.max(0, rounded);
  return Math.max(0, rounded);
}

export type ProjectedValues = {
  sets: number | null;
  reps: number | null;
  repsMax: number | null;
  intensity: number | null;
  /** A range's top end, moved by whatever the rules did to its bottom end. */
  intensityMax: number | null;
  duration: number | null;
  /** The typed weight, moved by a LOAD rule; a removed rule takes its weights with it. */
  load: number | null;
};

/** Applies every enabled rule, in order, to the base week's values. */
export function project(base: BaseValues, rules: Rule[], week: number, unit: Unit): ProjectedValues {
  let sets = base.sets;
  let reps = base.reps;
  let intensity = base.intensity;
  let duration = base.duration ?? null;
  let load = base.load ?? null;

  for (const rule of [...rules].sort((a, b) => a.order - b.order)) {
    if (!rule.enabled) continue;
    const times = applications(rule, week);
    if (times === 0) continue;

    if (rule.field === "SETS" && sets !== null) {
      sets = Math.max(1, Math.round(step(sets, rule, times)));
    } else if (rule.field === "REPS" && reps !== null) {
      reps = Math.max(1, Math.round(step(reps, rule, times)));
    } else if (rule.field === "INTENSITY" && intensity !== null) {
      intensity = roundIntensity(step(intensity, rule, times), base.intensityType, unit);
    } else if (rule.field === "DURATION" && duration !== null) {
      // Whole five seconds: a round of 3:07 is nobody's plan.
      duration = Math.max(5, Math.round(step(duration, rule, times) / 5) * 5);
    } else if (rule.field === "LOAD") {
      // The typed weight when the row has one; a weight intensity otherwise.
      if (load !== null) {
        load = Math.max(0, roundToIncrement(step(load, rule, times), unit));
      } else if (intensity !== null && (base.intensityType === "WEIGHT" || base.intensityType === "RANGE")) {
        intensity = Math.max(0, roundToIncrement(step(intensity, rule, times), unit));
      }
    }
  }

  // A range keeps its width: the top end travels with the bottom one rather than
  // being left behind where week 1 put it.
  const intensityMax =
    base.intensityMax !== null && base.intensity !== null && intensity !== null
      ? roundIntensity(
          base.intensityMax + (intensity - base.intensity),
          base.intensityType,
          unit,
        )
      : base.intensityMax;

  const repsMax =
    base.repsMax != null && base.reps !== null && reps !== null ? base.repsMax + (reps - base.reps) : (base.repsMax ?? null);

  return { sets, reps, repsMax, intensity, intensityMax, duration, load };
}

const FIELD_LABEL: Record<ProgField, string> = {
  SETS: "set",
  REPS: "rep",
  INTENSITY: "intensity",
  DURATION: "second",
  LOAD: "weight",
};

export function describeRule(rule: Rule, intensityType: IntensityType): string {
  const unit =
    rule.field === "INTENSITY"
      ? intensityType === "PERCENT"
        ? "%"
        : intensityType === "WEIGHT" || intensityType === "RANGE"
          ? "kg"
          : " RPE"
      : rule.field === "DURATION"
        ? "s"
        : rule.field === "LOAD"
          ? "kg"
          : ` ${t(Math.abs(rule.amount) === 1 ? FIELD_LABEL[rule.field] : `${FIELD_LABEL[rule.field]}s`)}`;

  const cadence = rule.everyWeeks === 1 ? t("wk") : t("{n} wks", { n: rule.everyWeeks });
  const window =
    rule.endWeek !== null
      ? rule.endWeek === rule.startWeek
        ? ` (${t("wk {n} only", { n: rule.startWeek })})`
        : ` (${t("wk")} ${rule.startWeek}–${rule.endWeek})`
      : rule.startWeek > 2
        ? ` (${t("from wk {n}", { n: rule.startWeek })})`
        : "";

  if (rule.op === "MULTIPLY") {
    return `×${rule.amount} ${t(FIELD_LABEL[rule.field])}/${cadence}${window}`;
  }
  const sign = rule.amount >= 0 ? "+" : "−";
  return `${sign}${Math.abs(rule.amount)}${unit}/${cadence}${window}`;
}
