import { repsText } from "@/lib/reps";

/**
 * Timed sets — a round, an interval — are kept in seconds and written the way a coach
 * says them: "5:00", "90s", "3'", "2m", "1:30:00". A bare number is minutes up to 30,
 * seconds above it: nobody means a 45-minute round, and nobody means a 3-second one.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase().replace(",", ".");
  if (s === "") return null;

  const clock = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(s);
  if (clock) {
    const [, a, b, c] = clock;
    return c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c);
  }

  const unit = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|"|m|min|mins|'|h)$/.exec(s);
  if (unit) {
    const n = Number(unit[1]);
    const factor = unit[2] === "h" ? 3600 : /^(m|min|mins|')$/.test(unit[2]) ? 60 : 1;
    return positive(Math.round(n * factor));
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return positive(Math.round(n <= 30 ? n * 60 : n));
}

/** Rest as the coach wrote it, in seconds: a range rests its low end ("2-3 min" → 120). */
export function restSeconds(text: string | null): number | null {
  return text ? parseDuration(text.replace(/\s*[-–\/]\s*[\d.:]+/, "")) : null;
}

const positive = (n: number) => (n > 0 && n <= 24 * 3600 ? n : null);

/** 300 → "5:00", 45 → "0:45", 3900 → "1:05:00". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Minutes a row asks for: rounds × round length. Null for an untimed row. */
export function rowMinutes(row: { sets: number | null; duration?: number | null }): number | null {
  if (!row.duration) return null;
  return (Math.max(1, row.sets ?? 1) * row.duration) / 60;
}

/** "5 × 5" or "3 × 8–10" for sets of reps, "5 × 3:00" for rounds, "3 × 10 / 0:40" for both. */
export function volumeText(row: { sets: number | null; reps: number | null; repsMax?: number | null; duration?: number | null }): string {
  const sets = row.sets ?? "—";
  const reps = repsText(row);
  if (!row.duration) return `${sets} × ${reps}`;
  const time = formatDuration(row.duration);
  return row.reps === null ? `${sets} × ${time}` : `${sets} × ${reps} / ${time}`;
}
