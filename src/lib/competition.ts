import type { AttemptResult, MeetLift, Unit } from "@prisma/client";
import { roundToIncrement } from "@/lib/intensity";
import { activeSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";

export const MEET_LIFTS: MeetLift[] = ["SQUAT", "BENCH", "DEADLIFT"];

export const LIFT_LABEL: Record<MeetLift, string> = {
  SQUAT: "Squat",
  BENCH: "Bench",
  DEADLIFT: "Deadlift",
};

export type AttemptData = {
  id: string;
  lift: MeetLift;
  number: number;
  weight: number | null;
  result: AttemptResult;
};

export type MeetData = {
  id: string;
  name: string;
  federation: string | null;
  weightClass: string | null;
  bodyweight: number | null;
  date: string;
  attempts: AttemptData[];
};

/**
 * A conventional opening plan off the 1RM on file: an opener you could triple, a second
 * near the max, a third at it. The coach edits from there — these are only suggestions,
 * and nothing writes them without being asked.
 */
function attemptShare(number: number): number {
  const share = activeSettings().attemptShare;
  return share[number as 1 | 2 | 3] ?? 1;
}

/** How much a successful attempt suggests adding for the next one. */
const JUMP = { 2: 1.04, 3: 1.03 } as const;

export function maxFor(
  lift: MeetLift,
  maxes: { squat1RM: number | null; bench1RM: number | null; dead1RM: number | null },
) {
  if (lift === "SQUAT") return maxes.squat1RM;
  if (lift === "BENCH") return maxes.bench1RM;
  return maxes.dead1RM;
}

export function planned(oneRM: number | null, number: number, unit: Unit): number | null {
  if (oneRM === null) return null;
  return roundToIncrement(oneRM * attemptShare(number), unit);
}

/**
 * What to put on the bar next, given how the previous attempt went: a make earns a jump,
 * a miss is repeated, and with nothing before it the plan off the 1RM stands.
 */
export function suggestion(
  attempts: AttemptData[],
  lift: MeetLift,
  number: number,
  oneRM: number | null,
  unit: Unit,
): number | null {
  if (number === 1) return planned(oneRM, 1, unit);

  const previous = attempts.find((a) => a.lift === lift && a.number === number - 1);
  if (!previous || previous.weight === null || previous.result === "PENDING") {
    return planned(oneRM, number, unit);
  }

  if (previous.result === "MISS") return previous.weight;
  return roundToIncrement(previous.weight * JUMP[number as 2 | 3], unit);
}

/** Heaviest successful attempt on a lift — what counts towards the total. */
export function best(attempts: AttemptData[], lift: MeetLift): number | null {
  const made = attempts.filter(
    (a) => a.lift === lift && a.result === "GOOD" && a.weight !== null,
  );
  if (made.length === 0) return null;
  return Math.max(...made.map((a) => a.weight as number));
}

/** The lifts this coach's meets are totalled on — all three, or e.g. bench alone. */
export function totalLifts(): MeetLift[] {
  const lifts = activeSettings().totalLifts.filter((l) => MEET_LIFTS.includes(l));
  return lifts.length > 0 ? lifts : MEET_LIFTS;
}

/** Null until every totalled lift has something good: a bombed lift means no total. */
export function total(attempts: AttemptData[]): number | null {
  const bests = totalLifts().map((lift) => best(attempts, lift));
  if (bests.some((b) => b === null)) return null;
  const sum = (bests as number[]).reduce((a, b) => a + b, 0);
  return Math.round(sum * 10) / 10;
}

/** A meet as the programming grid needs it: when it is, and what is on the bar. */
export type MeetSummary = {
  id: string;
  name: string;
  /** yyyy-mm-dd, so it compares without a timezone moving it a day. */
  date: string;
  attempts: { lift: MeetLift; number: number; weight: number | null }[];
};

/** The nine rows a meet day is made of, in the order they are lifted. */
export const ATTEMPT_ROWS = MEET_LIFTS.flatMap((lift) =>
  [1, 2, 3].map((number) => ({ lift, number })),
);

export function attemptExercise(lift: MeetLift, number: number) {
  return `${LIFT_LABEL[lift]} attempt ${number}`;
}

/** Recognises the rows this fill wrote, so running it again replaces them. */
export const ATTEMPT_PATTERN = /^(Squat|Bench|Deadlift) attempt [123]$/;

export function meetOn(meets: MeetSummary[], ymd: string): MeetSummary | null {
  return meets.find((meet) => meet.date === ymd) ?? null;
}

export function daysUntil(date: string, today: Date) {
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const meet = new Date(date);
  meet.setHours(0, 0, 0, 0);
  return Math.round((meet.getTime() - start.getTime()) / day);
}

export function countdown(date: string, today: Date) {
  const days = daysUntil(date, today);
  if (days === 0) return t("today");
  if (days === 1) return t("tomorrow");
  if (days > 0) return t("in {n} days", { n: days });
  return t("{n} days ago", { n: Math.abs(days) });
}
