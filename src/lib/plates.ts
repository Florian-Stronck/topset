import type { Unit } from "@prisma/client";

/** A standard competition set, heaviest first, and the bar that goes with it. */
export const PLATE_SETS: Record<Unit, { bar: number; collars: number; plates: number[] }> = {
  KG: { bar: 20, collars: 2.5, plates: [25, 20, 15, 10, 5, 2.5, 1.25, 0.5] },
  LB: { bar: 45, collars: 0, plates: [45, 35, 25, 10, 5, 2.5] },
};

export type PlateLoad = {
  /** Plates for one side, heaviest first. */
  perSide: number[];
  /** What the bar actually weighs loaded this way. */
  total: number;
  /** Target minus total: what the set couldn't make up. 0 when it lands exactly. */
  short: number;
};

/**
 * The plates for one side of the bar, greedily from the heaviest — how a loader
 * actually does it. A target under the bar (and collars) loads nothing.
 */
export function loadBar(
  target: number,
  opts: { bar: number; collars?: number; plates: number[] },
): PlateLoad {
  const empty = opts.bar + (opts.collars ?? 0);
  const perSide: number[] = [];
  // Work in hundredths so 1.25 plates don't pile up float error.
  let left = Math.max(0, Math.round(((target - empty) / 2) * 100));
  for (const plate of [...opts.plates].sort((a, b) => b - a)) {
    const p = Math.round(plate * 100);
    if (p <= 0) continue;
    while (left >= p) {
      perSide.push(plate);
      left -= p;
    }
  }
  const total = Number((empty + perSide.reduce((a, b) => a + b, 0) * 2).toFixed(2));
  return { perSide, total, short: Number(Math.max(0, target - total).toFixed(2)) };
}

/** IPF colours, so the picture reads like the platform. */
export function plateColor(plate: number, unit: Unit): string {
  const kg = unit === "LB" ? plate * 0.4536 : plate;
  if (kg >= 24) return "#d63a3a";
  if (kg >= 19) return "#2f6fd6";
  if (kg >= 14) return "#e0b420";
  if (kg >= 9) return "#3a9d52";
  if (kg >= 4.5) return "#f2f2f2";
  if (kg >= 2) return "#1f1f1f";
  return "#b8b8b8";
}
