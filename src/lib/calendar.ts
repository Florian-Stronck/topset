import { weekStartOf } from "@/lib/dates";
import { addDays } from "@/lib/schedule";
import { completion } from "@/lib/setlog";

/**
 * The athlete app's History calendar: a month as whole weeks, and what each day was.
 * White is training still to come, red training done, yellow a day with a PR, green a
 * competition. A training day that went by with nothing logged keeps its white ring only.
 */

export type DayKind = "meet" | "pr" | "done" | "missed" | "plan" | "none";

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
