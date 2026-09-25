import { weekdayOf } from "@/lib/dates";

/**
 * The readiness check-in: four 1–5 scores and a note, asked on the weekdays the coach
 * picks for each athlete. Every score reads the same way round — higher is better — so an
 * average means something without flipping any of them.
 */

export type ReadinessKey = "sleep" | "stress" | "soreness" | "energy";

export const READINESS_FIELDS: { key: ReadinessKey; label: string; low: string; high: string }[] = [
  { key: "sleep", label: "Sleep", low: "Poor", high: "Great" },
  { key: "stress", label: "Stress", low: "Very stressed", high: "Relaxed" },
  { key: "soreness", label: "Soreness", low: "Very sore", high: "Fresh" },
  { key: "energy", label: "Energy", low: "Flat", high: "Ready to go" },
];

export type ReadinessEntry = {
  id: string;
  day: string;
  sleep: number | null;
  stress: number | null;
  soreness: number | null;
  energy: number | null;
  note: string | null;
};

/** At or under this average, readiness is worth a look. */
export const LOW_READINESS = 2.5;

/** "0,3" → [0, 3]: the weekdays asked, 0 = Monday. Anything unreadable is dropped. */
export function parseDays(value: string | null | undefined): number[] {
  const parts = (value ?? "").split(",").map((d) => d.trim()).filter((d) => d !== "");
  return [...new Set(parts.map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
}

export function formatDays(days: number[]): string {
  return parseDays(days.join(",")).join(",");
}

/** Whether the check-in is asked on a `YYYY-MM-DD` day. */
export function asksOn(days: number[], ymd: string): boolean {
  return days.includes(weekdayOf(`${ymd}T00:00:00Z`));
}

/** The average of the scores given, to one decimal; null when none are. */
export function readinessScore(entry: Pick<ReadinessEntry, ReadinessKey>): number | null {
  const scores = READINESS_FIELDS.map((f) => entry[f.key]).filter((v): v is number => v !== null);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

/** A score from the app, kept only if it's a whole 1–5; anything else is no answer. */
export function cleanScore(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5 ? (value as number) : null;
}
