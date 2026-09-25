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
  intensity: number | null;
  intensityMax: number | null;
  intensityType: IntensityType;
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
  intensity: number | null;
  /** A range's top end, moved by whatever the rules did to its bottom end. */
  intensityMax: number | null;
};

/** Applies every enabled rule, in order, to the base week's values. */
export function project(base: BaseValues, rules: Rule[], week: number, unit: Unit): ProjectedValues {
  let sets = base.sets;
  let reps = base.reps;
  let intensity = base.intensity;

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

  return { sets, reps, intensity, intensityMax };
}

const FIELD_LABEL: Record<ProgField, string> = {
  SETS: "set",
  REPS: "rep",
  INTENSITY: "intensity",
};

export function describeRule(rule: Rule, intensityType: IntensityType): string {
  const unit =
    rule.field === "INTENSITY"
      ? intensityType === "PERCENT"
        ? "%"
        : intensityType === "WEIGHT" || intensityType === "RANGE"
          ? "kg"
          : " RPE"
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
