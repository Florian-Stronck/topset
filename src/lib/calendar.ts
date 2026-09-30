import { weekStartOf } from "@/lib/dates";
import { addDays } from "@/lib/schedule";
import { completion } from "@/lib/setlog";

/**
 * The athlete app's History calendar: a month as whole weeks, and what each day was.
 * White is training still to come, red training done, yellow a day with a PR, green a
 * competition. A training day that went by with nothing logged keeps its white ring only.
 */

export type DayKind = "meet" | "pr" | "done" | "missed" | "plan" | "none";

/** What a day has on top of its kind: a session moved onto it or off it, and meetings. */
export type DayMarks = {
  /** The planned day of a session the athlete moved onto this one. */
  movedFrom: string | null;
  /** Where the session planned for this day went. */
  movedTo: string | null;
  /** Meetings still standing on the day. */
  meetings: number;
};

/**
 * Each day's marks, for the days that have any: moves read both ways (the day a session
 * left and the day it landed), meetings that weren't called off or declined.
 */
export function dayMarks(
  moves: { fromDay: string; day: string }[],
  meetings: { day: string; status: string }[],
): Map<string, DayMarks> {
  const out = new Map<string, DayMarks>();
  const at = (ymd: string) => {
    let m = out.get(ymd);
    if (!m) out.set(ymd, (m = { movedFrom: null, movedTo: null, meetings: 0 }));
    return m;
  };
  for (const m of moves) {
    if (m.fromDay === m.day) continue;
    at(m.day).movedFrom = m.fromDay;
    at(m.fromDay).movedTo = m.day;
  }
  for (const m of meetings) if (m.status === "PROPOSED" || m.status === "ACCEPTED") at(m.day).meetings++;
  return out;
}

/** `YYYY-MM` for a month parameter; anything else is null. */
export function parseMonth(text: string | undefined): string | null {
  if (!text || !/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return null;
  return text;
}

/** The month `delta` months from `month`, as `YYYY-MM`. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * The days on a month's page, whole weeks from the coach's first day of the week (0 =
 * Monday): the month's own days, and the tail and head of the months either side.
 */
export function monthGrid(month: string, weekStart: number): { ymd: string; inMonth: boolean }[][] {
  const first = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  const weeks: { ymd: string; inMonth: boolean }[][] = [];
  for (let day = weekStartOf(first, weekStart); day < next; ) {
    const week = Array.from({ length: 7 }, (_, i) => {
      const ymd = addDays(day, i);
      return { ymd, inMonth: ymd.startsWith(month) };
    });
    weeks.push(week);
    day = addDays(day, 7);
  }
  return weeks;
}

/**
 * What a day was, most telling first: a competition, then a PR, then training done (all
 * of it or some), then training missed or still to come.
 */
export function dayKind(
  ymd: string,
  today: string,
  { session, meet }: { session: { done: number; prescribed: number; pr: boolean } | null; meet: boolean },
): DayKind {
  if (meet) return "meet";
  if (!session) return "none";
  if (session.pr) return "pr";
  if (completion(session.done, session.prescribed) !== "none") return "done";
  return ymd < today ? "missed" : "plan";
}
