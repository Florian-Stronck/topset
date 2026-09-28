/**
 * Reps as a number or a range: "8", "8-10", "8–10", "8 to 10". A range keeps its bottom in
 * `reps` — what loads and e1RMs are worked out from — and its top in `repsMax`.
 */
export type Reps = { reps: number | null; repsMax: number | null };

export function parseReps(text: string): Reps | null {
  const s = text.trim().toLowerCase();
  if (s === "") return { reps: null, repsMax: null };
  const m = /^(\d{1,3})(?:\s*(?:-|–|—|to)\s*(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? null : Number(m[2]);
  if (a < 1) return null;
  if (b === null || b === a) return { reps: a, repsMax: null };
  return { reps: Math.min(a, b), repsMax: Math.max(a, b) };
}

/** "8", "8–10", or "—" for none. */
export function repsText(row: { reps: number | null; repsMax?: number | null }): string {
  if (row.reps === null) return "—";
  return row.repsMax ? `${row.reps}–${row.repsMax}` : String(row.reps);
}
