import type { IntensityType, Tier, Unit } from "@prisma/client";
import { activeSettings, type RpeTable } from "@/lib/settings";
import { t } from "@/lib/i18n";

let curveCache: { table: RpeTable; curve: [number, number][] } | null = null;

/**
 * The chart as one curve over reps to failure (reps done + reps in reserve): every cell
 * is a point on it, and cells that land on the same point are averaged.
 */
function rtfCurve(table: RpeTable): [number, number][] {
  if (curveCache?.table === table) return curveCache.curve;
  const points = new Map<number, number[]>();
  table.rpe.forEach((rpe, r) =>
    table.reps.forEach((reps, c) => {
      const pct = table.pct[r]?.[c];
      if (typeof pct !== "number" || !Number.isFinite(pct)) return;
      const rtf = reps + (10 - rpe);
      points.set(rtf, [...(points.get(rtf) ?? []), pct]);
    }),
  );
  const curve = [...points]
    .map(([rtf, pcts]) => [rtf, pcts.reduce((a, b) => a + b, 0) / pcts.length] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  curveCache = { table, curve };
  return curve;
}

/**
 * %1RM for a set of `reps` at `rpe`, off the coach's RPE chart. A cell on the chart is
 * used as written; anything between or beyond its rows and columns is read from the same
 * chart by reps to failure, as long as the chart reaches that far.
 */
export function percentOf1RM(reps: number, rpe: number): number | null {
  const table = activeSettings().rpeTable;
  const r = table.rpe.indexOf(rpe);
  const c = table.reps.indexOf(reps);
  const cell = r >= 0 && c >= 0 ? table.pct[r]?.[c] : undefined;
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;

  const curve = rtfCurve(table);
  const rtf = reps + (10 - rpe);
  if (curve.length === 0 || rtf < curve[0][0] || rtf > curve[curve.length - 1][0]) return null;
  const hi = curve.findIndex(([x]) => x >= rtf);
  const [x1, y1] = curve[hi];
  if (x1 === rtf || hi === 0) return y1;
  const [x0, y0] = curve[hi - 1];
  return y0 + ((y1 - y0) * (rtf - x0)) / (x1 - x0);
}

/** A percentage or RPE as the coach wants to read it: their decimals, no trailing zeros. */
export function fmt(n: number): string {
  const d = activeSettings().decimals;
  return String(Number(n.toFixed(d)));
}

/**
 * Backs a 1RM out of a set that was actually performed: the RPE says how many reps
 * were left, and the same table that prescribes a load reads it in reverse.
 */
export function estimate1RM(
  weight: number,
  reps: number | null,
  rpe: number | null,
  unit: Unit,
): number | null {
  if (reps === null) return null;
  const formula = activeSettings().e1rmFormula;

  if (formula === "rpe") {
    if (rpe === null) return null;
    const pct = percentOf1RM(reps, rpe);
    if (pct === null || pct <= 0) return null;
    return roundToIncrement((weight * 100) / pct, unit);
  }

  // Rep formulas count the reps that were left in the tank as done; no RPE means none were.
  const rtf = reps + (rpe === null ? 0 : 10 - rpe);
  if (rtf < 1) return null;
  const e1rm = formula === "epley" ? weight * (1 + rtf / 30) : (weight * 36) / (37 - Math.min(rtf, 36));
  return roundToIncrement(rtf === 1 ? weight : e1rm, unit);
}

export function roundToIncrement(weight: number, unit: Unit): number {
  const { roundKg, roundLb } = activeSettings();
  const inc = unit === "LB" ? roundLb : roundKg;
  if (!(inc > 0)) return weight;
  // Clears float noise like 102.50000000001 off the result.
  return Number((Math.round(weight / inc) * inc).toFixed(3));
}

export type AthleteMaxes = {
  squat1RM: number | null;
  bench1RM: number | null;
  dead1RM: number | null;
  unit: Unit;
};

/**
 * The maxes a program resolves against. They live on the block, so a PR set after it was
 * written — or a max typed in for the next block — never moves weights already handed to
 * the athlete. A block from before maxes moved onto the block falls back to the athlete's.
 */
export function maxesOf(
  block: { squat1RM: number | null; bench1RM: number | null; dead1RM: number | null },
  athlete: AthleteMaxes,
): AthleteMaxes {
  return {
    squat1RM: block.squat1RM ?? athlete.squat1RM,
    bench1RM: block.bench1RM ?? athlete.bench1RM,
    dead1RM: block.dead1RM ?? athlete.dead1RM,
    unit: athlete.unit,
  };
}

/** A variation is trained off a lower max than the competition lift. */
export const VARIATION_FACTOR = 0.9;

type Lift = "squat" | "bench" | "dead";

/** Recognises both spelled-out targets ("Back Squat") and the usual shorthand (SQ/BP/DL). */
export function liftOf(target: string): Lift | null {
  const text = target.trim().toLowerCase();
  const words = text.split(/[^a-z]+/).filter(Boolean);
  const hasWord = (...names: string[]) => names.some((n) => words.includes(n));

  if (text.includes("squat") || hasWord("sq", "squats")) return "squat";
  if (text.includes("bench") || hasWord("bp", "benches")) return "bench";
  if (text.includes("dead") || hasWord("dl", "deads")) return "dead";
  return null;
}

// Only main-lift rows get a calculated weight; accessories show the raw prescription.
export function oneRepMaxFor(target: string, tier: Tier, maxes: AthleteMaxes): number | null {
  if (tier === "ACCESSORY") return null;

  const lift = liftOf(target);
  if (lift === null) return null;

  const max =
    lift === "squat" ? maxes.squat1RM : lift === "bench" ? maxes.bench1RM : maxes.dead1RM;
  if (max === null) return null;

  return tier === "VARIATION" ? max * VARIATION_FACTOR : max;
}

export type CellPrescription = {
  sets?: number | null;
  reps: number | null;
  intensityType: IntensityType;
  intensity: number | null;
  intensityMax: number | null;
  rampStep?: number | null;
};

export type ResolvedIntensity = {
  label: string;
  weight: number | null;
  /** Per-set ladder when the cell ramps: the target weight, then one step up per set. */
  ramp: number[];
};

/** Ladder that lands on the target weight: the last set is `top`, each earlier set `step` lighter. */
export function rampWeights(
  top: number,
  sets: number | null | undefined,
  step: number,
  unit: Unit,
): number[] {
  const count = Math.max(1, sets ?? 1);
  return Array.from({ length: count }, (_, i) =>
    roundToIncrement(top - step * (count - 1 - i), unit),
  );
}

/** The prescription as written by the coach, independent of the weight it resolves to. */
export function formatPrescription(cell: CellPrescription, unit: Unit): string {
  const { intensityType: type, intensity, intensityMax } = cell;
  if (intensity === null) return "—";
  const u = unit === "LB" ? "lb" : "kg";

  switch (type) {
    case "PERCENT":
      return `${fmt(intensity)}%`;
    case "WEIGHT":
      return `${intensity} ${u}`;
    case "RANGE":
      return `${intensity}–${intensityMax ?? intensity} ${u}`;
    case "BACKOFF":
      return `${t("top")} −${fmt(intensity)}%`;
    case "RIR":
      return `RIR ${fmt(intensity)}`;
    default:
      return `RPE ${fmt(intensity)}`;
  }
}

export function formatRamp(cell: CellPrescription, unit: Unit): string | null {
  if (!cell.rampStep) return null;
  const u = unit === "LB" ? "lb" : "kg";
  return `ramp +${cell.rampStep} ${u}/set`;
}

export function resolveIntensity(
  cell: CellPrescription,
  oneRM: number | null,
  unit: Unit,
  topSet: number | null = null,
): ResolvedIntensity {
  const base = resolveBase(cell, oneRM, unit, topSet);
  const step = cell.rampStep ?? null;
  if (step === null || base.weight === null) return { ...base, ramp: [] };

  const ramp = rampWeights(base.weight, cell.sets, step, unit);
  const u = unit === "LB" ? "lb" : "kg";
  return {
    label: ramp.length > 1 ? `${ramp[0]}→${ramp[ramp.length - 1]} ${u}` : base.label,
    weight: base.weight,
    ramp,
  };
}

function resolveBase(
  cell: CellPrescription,
  oneRM: number | null,
  unit: Unit,
  topSet: number | null,
): Omit<ResolvedIntensity, "ramp"> {
  const { intensityType: type, intensity, intensityMax, reps } = cell;
  if (intensity === null) return { label: "—", weight: null };

  const u = unit === "LB" ? "lb" : "kg";

  if (type === "BACKOFF") {
    const w = topSet === null ? null : roundToIncrement((topSet * (100 - intensity)) / 100, unit);
    return { label: w === null ? `${t("top")} −${fmt(intensity)}%` : `${w} ${u}`, weight: w };
  }
  if (type === "WEIGHT") return { label: `${intensity} ${u}`, weight: intensity };
  if (type === "RANGE") {
    const hi = intensityMax ?? intensity;
    return { label: `${intensity}–${hi} ${u}`, weight: intensity };
  }
  if (type === "PERCENT") {
    const w = oneRM ? roundToIncrement((oneRM * intensity) / 100, unit) : null;
    return { label: w ? `${w} ${u}` : `${fmt(intensity)}%`, weight: w };
  }

  const rpe = type === "RIR" ? 10 - intensity : intensity;
  const raw = type === "RIR" ? `RIR ${fmt(intensity)}` : `RPE ${fmt(intensity)}`;
  if (!oneRM || reps === null) return { label: raw, weight: null };

  const pct = percentOf1RM(reps, rpe);
  if (pct === null) return { label: raw, weight: null };

  const w = roundToIncrement((oneRM * pct) / 100, unit);
  return { label: `${w} ${u}`, weight: w };
}

type ResolvableRow = CellPrescription & {
  id: string;
  tier: Tier;
  target: string;
};

/**
 * Resolves a day's rows in order. Backoff sets need this context: they hang off the
 * last row above them that produced a real weight — the top set — so two backoffs in
 * a row both reference that same top set.
 */
export function resolveDay(
  rows: ResolvableRow[],
  maxes: AthleteMaxes,
): Map<string, ResolvedIntensity> {
  const resolved = new Map<string, ResolvedIntensity>();
  let topSet: number | null = null;

  for (const row of rows) {
    const oneRM = oneRepMaxFor(row.target, row.tier, maxes);
    const result = resolveIntensity(row, oneRM, maxes.unit, topSet);
    resolved.set(row.id, result);

    if (row.intensityType !== "BACKOFF" && result.weight !== null) topSet = result.weight;
  }

  return resolved;
}
