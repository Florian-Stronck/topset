import { daysBetween } from "@/lib/schedule";

/**
 * Sessions the athlete moved to another date. The plan stays as the coach wrote it; a move
 * only says "this session is done on that day instead", and the calendar reads it on top.
 * One move per session, under an id named after it, so the athlete moving it again and the
 * coach putting it back all write the same row.
 */

export const moveId = (dayId: string) => `mv-${dayId}`;

/** Past this a reason is a letter, not a reason. */
export const MAX_REASON = 500;

/** How far a session can go from where the plan puts it. */
export const MAX_MOVE_DAYS = 28;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type MoveData = {
  id: string;
  dayId: string;
  /** Where the plan puts it. */
  fromDay: string;
  /** Where it is done instead. */
  day: string;
  reason: string | null;
  /** When the coach saw it; null while it's news. */
  seenAt: string | null;
  updatedAt: string;
};

export function moveData(row: {
  id: string;
  dayId: string;
  fromDay: string;
  day: string;
  reason: string | null;
  seenAt: Date | null;
  updatedAt: Date;
}): MoveData {
  return {
    id: row.id,
    dayId: row.dayId,
    fromDay: row.fromDay,
    day: row.day,
    reason: row.reason,
    seenAt: row.seenAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Session → the date it moved to, for laying out the calendar. */
export function movesMap(moves: { dayId: string; day: string }[]): Map<string, string> {
  return new Map(moves.map((m) => [m.dayId, m.day]));
}

export function cleanReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const text = reason.trim();
  if (text === "") return null;
  if (text.length > MAX_REASON) throw new Error("That reason is too long.");
  return text;
}

/**
 * Why a session can't go from `from` to `to`, or null when it can. `taken` holds the dates
 * that already have a session, not counting this one; `today` is on the athlete's calendar.
 */
export function moveProblem(from: string, to: string, today: string, taken: Set<string>): string | null {
  if (!YMD.test(to) || Number.isNaN(Date.parse(to))) return "That day isn't a date.";
  if (to === from) return null;
  if (to < today) return "Pick today or a day still to come.";
  if (Math.abs(daysBetween(from, to)) > MAX_MOVE_DAYS) return "That's too far from the planned day.";
  if (taken.has(to)) return "There's already a session on that day.";
  return null;
}
