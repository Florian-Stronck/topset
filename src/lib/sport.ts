import type { IntensityType, Sport } from "@prisma/client";

/**
 * What a fighter's intensity picker offers: effort as a % (on a round, "70%" is how hard to
 * go; on a lift, of the 1RM), reps in reserve, a range, a fixed weight or a back-off. RPE
 * is a lifter's scale.
 */
export const FIGHTER_INTENSITIES: IntensityType[] = ["PERCENT", "RIR", "RANGE", "WEIGHT", "BACKOFF"];

/** The kinds the picker offers this athlete; undefined for all of them. */
export function intensitiesFor(sport: Sport): IntensityType[] | undefined {
  return sport === "FIGHTER" ? FIGHTER_INTENSITIES : undefined;
}

/**
 * A new row's prescription for this athlete: the coach's defaults, with a fighter's effort
 * in reps in reserve — an RPE 8 default becomes RIR 2.
 */
export function newRowFor<T extends { intensityType: IntensityType; intensity: number | null }>(row: T, sport: Sport): T {
  if (sport !== "FIGHTER" || FIGHTER_INTENSITIES.includes(row.intensityType)) return row;
  const rir = row.intensityType === "RPE" && row.intensity !== null ? Math.max(0, 10 - row.intensity) : null;
  return { ...row, intensityType: "RIR", intensity: rir };
}
