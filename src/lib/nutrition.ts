import { NUTRIENTS, type Nutrient } from "@/lib/checkins";
import { ymdOf } from "@/lib/dates";
import { addDays } from "@/lib/schedule";

/**
 * Nutrition, kept like bodyweight: a log of the day's totals — calories and the three
 * macros — that the athlete fills from their check-in and the coach can type into too.
 * One row per athlete and day, so the check-in's calorie question and its protein question
 * fill in the same row.
 */

export type NutritionEntry = {
  id: string;
  day: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  source: "athlete" | "coach";
};

/** The id of an athlete's row for a day, the same on every copy of the database. */
export const nutritionId = (athleteId: string, day: string) => `n-${athleteId}-${day}`;

/** Past these a number is a typo. */
export const NUTRIENT_MAX: Record<Nutrient, number> = { kcal: 20000, protein: 2000, carbs: 2000, fat: 2000 };

/** A typed-in amount as stored: a whole number, or null for none or nonsense. */
export function cleanAmount(nutrient: Nutrient, raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  return Number.isFinite(n) && n >= 0 && n <= NUTRIENT_MAX[nutrient] ? Math.round(n) : null;
}

/** A stored row as the screens take it. */
export function nutritionEntry(row: {
  id: string;
  day: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  source: string;
}): NutritionEntry {
  const { id, day, kcal, protein, carbs, fat } = row;
  return { id, day, kcal, protein, carbs, fat, source: row.source === "coach" ? "coach" : "athlete" };
}

/** Whether a row has nothing left in it, and should go as a tombstone. */
export const isEmpty = (e: Pick<NutritionEntry, Nutrient>) => NUTRIENTS.every((n) => e[n] === null);

/** Each nutrient's mean over the days logged in the `span` days up to `day`; null where none. */
export function averages(entries: NutritionEntry[], day: string, span = 7): Record<Nutrient, number | null> {
  const from = addDays(day, -(span - 1));
  const inside = entries.filter((e) => e.day >= from && e.day <= day);
  const out = {} as Record<Nutrient, number | null>;
  for (const n of NUTRIENTS) {
    const vals = inside.map((e) => e[n]).filter((v): v is number => v !== null);
    out[n] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  return out;
}

// --- targets ------------------------------------------------------------------------------

/**
 * What the athlete eats to on a day: the targets of the phase that day falls in, one set
 * for every day of the phase. Null where the coach set none.
 */
export type NutritionTarget = Record<Nutrient, number | null>;

/** A phase's stretch of days, `from` up to but not including `to`, and its targets. */
export type TargetSpan = { from: string; to: string; target: NutritionTarget };

/** A phase row's targets, or null when it has none at all. */
export function phaseTarget(row: { kcalTarget: number | null; proteinTarget: number | null; carbsTarget: number | null; fatTarget: number | null }): NutritionTarget | null {
  const target = { kcal: row.kcalTarget, protein: row.proteinTarget, carbs: row.carbsTarget, fat: row.fatTarget };
  return isEmpty(target) ? null : target;
}

/** A phase's span of days, from its start and length, if it has targets. */
export function targetSpan(phase: { startDate: Date; weeks: number } & Parameters<typeof phaseTarget>[0]): TargetSpan | null {
  const target = phaseTarget(phase);
  if (!target) return null;
  const from = ymdOf(phase.startDate);
  return { from, to: addDays(from, phase.weeks * 7), target };
}

/** The target on a day; where phases overlap, the one that started last. */
export function targetOn(spans: TargetSpan[], day: string): NutritionTarget | null {
  let best: TargetSpan | null = null;
  for (const s of spans) if (s.from <= day && day < s.to && (!best || s.from > best.from)) best = s;
  return best?.target ?? null;
}

/** How far calories may land from the target and still count. */
export const KCAL_TOLERANCE = 0.1;

/**
 * Whether a day hit its target: calories within 10% either way, and protein at least the
 * target — whichever of the two the coach set. Carbs and fat are shown, not judged. Null
 * when there is nothing to judge: no target for either, or the day didn't log them.
 */
export function hitTarget(entry: Pick<NutritionEntry, "kcal" | "protein">, target: NutritionTarget | null): boolean | null {
  if (!target || (target.kcal === null && target.protein === null)) return null;
  if ((target.kcal !== null && entry.kcal === null) || (target.protein !== null && entry.protein === null)) return null;
  const kcalOk = target.kcal === null || Math.abs(entry.kcal! - target.kcal) <= target.kcal * KCAL_TOLERANCE;
  const proteinOk = target.protein === null || entry.protein! >= target.protein;
  return kcalOk && proteinOk;
}
