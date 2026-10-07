import type { IntensityType, Tier, Unit } from "@prisma/client";
import { activeSettings, type RpeTable } from "@/lib/settings";
import { t } from "@/lib/i18n";

// Per chart, since an athlete's own and the coach's are read side by side.
const curves = new WeakMap<RpeTable, [number, number][]>();

/**
 * The chart as one curve over reps to failure (reps done + reps in reserve): every cell
 * is a point on it, and cells that land on the same point are averaged.
 */
function rtfCurve(table: RpeTable): [number, number][] {
  const cached = curves.get(table);
  if (cached) return cached;
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
  curves.set(table, curve);
  return curve;
}

/** The chart's curve read at any reps to failure inside its range; null outside it. */
export function curveAt(table: RpeTable, rtf: number): number | null {
  const curve = rtfCurve(table);
  if (curve.length === 0 || rtf < curve[0][0] || rtf > curve[curve.length - 1][0]) return null;
  const hi = curve.findIndex(([x]) => x >= rtf);
  const [x1, y1] = curve[hi];
  if (x1 === rtf || hi === 0) return y1;
  const [x0, y0] = curve[hi - 1];
  return y0 + ((y1 - y0) * (rtf - x0)) / (x1 - x0);
}

export type CurveHandle = { x: number; y: number };

/** Every reps to failure a chart covers, lowest to highest. */
function rtfRange(table: RpeTable): [number, number] {
  const rtfs = table.rpe.flatMap((rpe) => table.reps.map((reps) => reps + (10 - rpe)));
  return [Math.min(...rtfs), Math.max(...rtfs)];
}

/** Where the handles sit along the curve: dense at the heavy end, where a % matters most. */
const HANDLE_SPOTS = [0, 1 / 12, 3 / 12, 5 / 12, 8 / 12, 1];

/** A chart as a few draggable points on its curve, for shaping it by hand. */
export function curveHandles(table: RpeTable): CurveHandle[] {
  const [lo, hi] = rtfRange(table);
  return HANDLE_SPOTS.map((f) => {
    const x = lo + (hi - lo) * f;
    return { x, y: curveAt(table, x) ?? 100 };
  });
}

/**
 * A smooth line through the handles that never overshoots them (monotone cubic,
 * Fritsch–Carlson), so a steeper handle can't make a lighter set read heavier.
 */
export function smoothCurve(points: CurveHandle[]): (x: number) => number {
  const n = points.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x));
  const m = points.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      m[i] = (3 / Math.sqrt(s)) * a * d[i];
      m[i + 1] = (3 / Math.sqrt(s)) * b * d[i];
    }
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > points[i + 1].x) i++;
    const h = points[i + 1].x - points[i].x;
    const t = (x - points[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * points[i].y +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * points[i + 1].y +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

/**
 * The chart after its curve was reshaped: each cell moves by as much as the curve moved at
 * its reps to failure, to half a percent. Parts of the curve left alone, and cells typed in
 * by hand there, stay exactly as they were.
 */
export function tableFromCurve(table: RpeTable, handles: CurveHandle[], from: CurveHandle[] = curveHandles(table)): RpeTable {
  const after = smoothCurve(handles);
  const before = smoothCurve(from);
  return {
    ...table,
    pct: table.pct.map((row, r) =>
      row.map((pct, c) => {
        const rtf = table.reps[c] + (10 - table.rpe[r]);
        const moved = after(rtf) - before(rtf);
        return Math.abs(moved) < 0.01 ? pct : Math.min(100, Math.round((pct + moved) * 2) / 2);
      }),
    ),
  };
}

const parsedTables = new Map<string, RpeTable | null>();

/**
 * `Athlete.rpeTable` read back: the athlete's own chart, or null to use the coach's.
 * Anything malformed counts as none, so a bad value can never break a program.
 */
export function parseRpeTable(json: string | null | undefined): RpeTable | null {
  if (!json) return null;
  if (parsedTables.has(json)) return parsedTables.get(json)!;
  let table: RpeTable | null = null;
  try {
    const v = JSON.parse(json);
    const nums = (a: unknown) => Array.isArray(a) && a.every((n) => typeof n === "number" && Number.isFinite(n));
    if (
      nums(v?.rpe) && nums(v?.reps) && Array.isArray(v?.pct) && v.pct.length === v.rpe.length &&
      v.pct.every((row: unknown) => nums(row) && (row as number[]).length === v.reps.length)
    ) {
      table = { rpe: v.rpe, reps: v.reps, pct: v.pct };
    }
  } catch {}
  parsedTables.set(json, table);
  return table;
}

/** The chart a set is read off: the athlete's own if they have one, else the coach's. */
export function rpeTableFor(athlete: { rpeTable?: string | null } | null | undefined): RpeTable {
  return parseRpeTable(athlete?.rpeTable) ?? activeSettings().rpeTable;
}

/**
 * %1RM for a set of `reps` at `rpe`, off an RPE chart — the coach's unless one is given.
 * A cell on the chart is used as written; anything between or beyond its rows and columns
 * is read from the same chart by reps to failure, as long as the chart reaches that far.
 */
export function percentOf1RM(reps: number, rpe: number, table: RpeTable = activeSettings().rpeTable): number | null {
  const r = table.rpe.indexOf(rpe);
  const c = table.reps.indexOf(reps);
  const cell = r >= 0 && c >= 0 ? table.pct[r]?.[c] : undefined;
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  return curveAt(table, reps + (10 - rpe));
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
  table?: RpeTable,
): number | null {
  if (reps === null) return null;
  const formula = activeSettings().e1rmFormula;

  if (formula === "rpe") {
    if (rpe === null) return null;
    const pct = percentOf1RM(reps, rpe, table);
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
  /** The athlete's variation drop-off, `Athlete.variationPct`; null uses the coach's. */
  variationPct?: number | null;
  /** Per-exercise drop-offs as JSON, `Athlete.variationPcts`. */
  variationPcts?: string | null;
  /** The athlete's own RPE chart as JSON, `Athlete.rpeTable`; null uses the coach's. */
  rpeTable?: string | null;
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
    variationPct: athlete.variationPct,
    variationPcts: athlete.variationPcts,
    rpeTable: athlete.rpeTable,
  };
}

/** `Athlete.variationPcts` read back; anything unreadable counts as none. */
export function parseVariationPcts(json: string | null | undefined): Record<string, number> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === "number" && v > 0 && v <= 200),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

const pctCache = new Map<string, Record<string, number>>();

/**
 * The % of the competition max a variation is trained off: this exercise's own for the
 * athlete, else the athlete's, else the coach's default.
 */
export function variationPercent(exercise: string, maxes: AthleteMaxes): number {
  const json = maxes.variationPcts ?? "";
  let byExercise = pctCache.get(json);
  if (!byExercise) {
    byExercise = parseVariationPcts(json);
    pctCache.set(json, byExercise);
  }
  const key = exercise.trim().toLowerCase();
  const own = Object.entries(byExercise).find(([name]) => name.trim().toLowerCase() === key)?.[1];
  return own ?? maxes.variationPct ?? activeSettings().variationPercent;
}

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
export function oneRepMaxFor(target: string, tier: Tier, maxes: AthleteMaxes, exercise = ""): number | null {
  if (tier === "ACCESSORY") return null;

  const lift = liftOf(target);
  if (lift === null) return null;

  const max =
    lift === "squat" ? maxes.squat1RM : lift === "bench" ? maxes.bench1RM : maxes.dead1RM;
  if (max === null) return null;

  return tier === "VARIATION" ? (max * variationPercent(exercise, maxes)) / 100 : max;
}

export type CellPrescription = {
  sets?: number | null;
  reps: number | null;
  intensityType: IntensityType;
  intensity: number | null;
  intensityMax: number | null;
  rampStep?: number | null;
  /** A weight typed over the one the intensity works out to. */
  load?: number | null;
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
  table?: RpeTable,
): ResolvedIntensity {
  const base =
    cell.load == null
      ? resolveBase(cell, oneRM, unit, topSet, table)
      : { label: `${cell.load} ${unit === "LB" ? "lb" : "kg"}`, weight: cell.load };
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
  table?: RpeTable,
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

  const pct = percentOf1RM(reps, rpe, table);
  if (pct === null) return { label: raw, weight: null };

  const w = roundToIncrement((oneRM * pct) / 100, unit);
  return { label: `${w} ${u}`, weight: w };
}

type ResolvableRow = CellPrescription & {
  id: string;
  tier: Tier;
  target: string;
  exercise?: string;
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
  const table = rpeTableFor(maxes);

  for (const row of rows) {
    const oneRM = oneRepMaxFor(row.target, row.tier, maxes, row.exercise);
    const result = resolveIntensity(row, oneRM, maxes.unit, topSet, table);
    resolved.set(row.id, result);

    if (row.intensityType !== "BACKOFF" && result.weight !== null) topSet = result.weight;
  }

  return resolved;
}
