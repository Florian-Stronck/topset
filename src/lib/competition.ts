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

/**
 * What the total would be if every attempt still standing goes: per lift the heaviest one
 * made or still to come. Null while a totalled lift has nothing left that could count.
 */
export function projectedTotal(attempts: AttemptData[]): number | null {
  const tops = totalLifts().map((lift) => {
    const live = attempts.filter((a) => a.lift === lift && a.result !== "MISS" && a.weight !== null);
    return live.length === 0 ? null : Math.max(...live.map((a) => a.weight as number));
  });
  if (tops.some((w) => w === null)) return null;
  return Math.round((tops as number[]).reduce((a, b) => a + b, 0) * 10) / 10;
}

/** The attempt the platform is on: the first one, in lifting order, not yet called. */
export function currentAttempt(attempts: AttemptData[]): { lift: MeetLift; number: number } | null {
  return (
    ATTEMPT_ROWS.find(({ lift, number }) => {
      const a = attempts.find((x) => x.lift === lift && x.number === number);
      return !a || a.result === "PENDING";
    }) ?? null
  );
}

/** DOTS polynomial coefficients (a·bw⁴ … e) and the bodyweight range they hold over. */
const DOTS = {
  M: { c: [-0.000001093, 0.0007391293, -0.1918759221, 24.0900756, -307.75076], max: 210 },
  F: { c: [-0.0000010706, 0.0005158568, -0.1126655495, 13.6175032, -57.96288], max: 150 },
} as const;

/** IPF GL (2020) coefficients for classic lifting: the full total, and bench-only meets. */
const GL = {
  total: { M: [1199.72839, 1025.18162, 0.00921], F: [610.32796, 1045.59282, 0.03048] },
  bench: { M: [320.98041, 281.40258, 0.01008], F: [142.40398, 442.52671, 0.04724] },
} as const;

export function scoreName(): string {
  return activeSettings().meetScore === "gl" ? "GL" : "DOTS";
}

/**
 * A total scored across bodyweights — DOTS or IPF GL, as the coach chose — with the total
 * and bodyweight in the athlete's unit. Null if anything is missing.
 */
export function meetScore(
  total: number | null,
  bodyweight: number | null,
  sex: string | null | undefined,
  unit: Unit,
  kind: "dots" | "gl" = activeSettings().meetScore,
): number | null {
  if (total === null || bodyweight === null || (sex !== "M" && sex !== "F")) return null;
  const kg = unit === "LB" ? 0.45359237 : 1;
  const bw = bodyweight * kg;
  let points: number;
  if (kind === "gl") {
    const lifts = totalLifts();
    const event = lifts.length === 1 && lifts[0] === "BENCH" ? "bench" : "total";
    const [a, b, c] = GL[event][sex];
    if (bw < 35) return null;
    points = (total * kg * 100) / (a - b * Math.exp(-c * bw));
  } else {
    const { c, max } = DOTS[sex];
    const clamped = Math.min(Math.max(bw, 40), max);
    points = (total * kg * 500) / c.reduce((sum, coef) => sum * clamped + coef, 0);
  }
  return Math.round(points * 100) / 100;
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
