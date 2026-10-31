import type { AttemptResult, MeetLift, Unit } from "@prisma/client";
import { roundToIncrement } from "@/lib/intensity";
import { activeSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";
import type { ReminderFacts, ReminderSettings } from "@/lib/meet-reminders";

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

/** Rack settings as the athlete calls them, on one brand of rack. */
export type Rack = { squat: string | null; bench: string | null; safety: string | null };

export const NO_RACK: Rack = { squat: null, bench: null, safety: null };

const rackValue = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 20) : null);

/** `Athlete.racks` read back: their settings on each brand of rack; anything unreadable counts as none. */
export function parseRacks(json: string | null | undefined): Record<string, Rack> {
  try {
    const raw: unknown = JSON.parse(json ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, Record<string, unknown> | null>)
        .filter(([brand]) => brand.trim() !== "")
        .map(([brand, r]) => [brand, { squat: rackValue(r?.squat), bench: rackValue(r?.bench), safety: rackValue(r?.safety) }]),
    );
  } catch {
    return {};
  }
}

/** A brand as the athlete's profile already spells it, so "eleiko" finds "Eleiko". */
export function rackBrand(racks: Record<string, Rack>, brand: string | null | undefined): string | null {
  const name = brand?.trim();
  if (!name) return null;
  return Object.keys(racks).find((b) => b.toLowerCase() === name.toLowerCase()) ?? name;
}

/** The athlete's settings on a brand of rack; blank where they have none. */
export function rackFor(racks: Record<string, Rack>, brand: string | null | undefined): Rack {
  const known = rackBrand(racks, brand);
  return (known && racks[known]) || NO_RACK;
}

/** "athlete" or "coach": whose a checklist item is to sort, and who ticked it. */
export type TaskOwner = "athlete" | "coach";

/** One thing to sort before the meet. */
export type TaskData = { id: string; text: string; owner: TaskOwner; done: boolean; doneBy: TaskOwner | null; updatedAt: string };

export type MeetData = {
  id: string;
  name: string;
  federation: string | null;
  weightClass: string | null;
  /** At weigh-in: the coach's, else what the athlete logged on weigh-in day. */
  bodyweight: number | null;
  date: string;
  goal: number | null;
  venue: string | null;
  weighInDay: string | null;
  weighInTime: string | null;
  startTime: string | null;
  session: string | null;
  /** The brand of rack it lifts on, and the athlete's settings on that brand. */
  rackBrand: string | null;
  racks: Rack;
  shared: boolean;
  shareAttempts: boolean;
  reminders: ReminderSettings;
  tasks: TaskData[];
  attempts: AttemptData[];
};

/** What most meets need sorted beforehand, and whose each usually is, for a checklist that starts empty. */
export const USUAL_TASKS: { text: string; owner: TaskOwner }[] = [
  { text: "Entry paid", owner: "coach" },
  { text: "Federation card valid", owner: "athlete" },
  { text: "Belt and sleeves on the approved list", owner: "athlete" },
  { text: "Singlet and long socks packed", owner: "athlete" },
  { text: "Travel and hotel booked", owner: "coach" },
  { text: "Openers rehearsed in training", owner: "athlete" },
  { text: "Rack heights checked", owner: "coach" },
  { text: "Weigh-in food and drink packed", owner: "athlete" },
];

/** What the reminders can say about a meet: see `reminderText`. */
export function reminderFacts(
  meet: Pick<MeetData, "name" | "date" | "weighInDay" | "weighInTime" | "startTime" | "session" | "racks" | "shareAttempts" | "attempts">,
  tasks: Pick<TaskData, "text" | "owner" | "done">[],
  unit: Unit,
  /** A lift's name in the athlete's language. */
  label: (lift: MeetLift) => string = (l) => t(LIFT_LABEL[l]),
): ReminderFacts {
  const sum = currentAttempt(meet.attempts) === null ? total(meet.attempts) : null;
  return {
    meet: meet.name,
    day: meet.date.slice(0, 10),
    weighInDay: meet.weighInDay,
    weighInTime: meet.weighInTime,
    startTime: meet.startTime,
    session: meet.session,
    racks: { squat: meet.racks.squat, bench: meet.racks.bench },
    openers: meet.shareAttempts ? MEET_LIFTS.map((l) => weightOf(meet.attempts, l, 1)) : null,
    open: tasks.filter((x) => x.owner === "athlete" && !x.done).map((x) => x.text),
    result:
      sum === null
        ? null
        : {
            total: sum,
            lifts: totalLifts().flatMap((l) => {
              const w = best(meet.attempts, l);
              return w === null ? [] : [{ label: label(l), weight: w }];
            }),
          },
    unit: unit === "LB" ? "lb" : "kg",
  };
}

/** Where a third attempt sits against the plan: one jump under it, on it, or one jump over. */
export type ThirdPlan = "safe" | "planned" | "push";

export const THIRD_PLANS: ThirdPlan[] = ["safe", "planned", "push"];

/** The smallest jump a meet takes. */
export const meetJump = (unit: Unit) => (unit === "LB" ? 5 : 2.5);

export function thirdFor(plan: ThirdPlan, oneRM: number | null, unit: Unit): number | null {
  const base = planned(oneRM, 3, unit);
  if (base === null) return null;
  return plan === "safe" ? base - meetJump(unit) : plan === "push" ? base + meetJump(unit) : base;
}

/** The total if each totalled lift lands on the weight `pick` gives it; null if one has none. */
export function totalOf(pick: (lift: MeetLift) => number | null): number | null {
  const weights = totalLifts().map(pick);
  if (weights.some((w) => w === null)) return null;
  return Math.round((weights as number[]).reduce((a, b) => a + b, 0) * 10) / 10;
}

export const weightOf = (attempts: AttemptData[], lift: MeetLift, number: number) =>
  attempts.find((a) => a.lift === lift && a.number === number)?.weight ?? null;

/** Made out of called: attempts still pending count for neither. */
export type Rate = { made: number; called: number };

function rate(attempts: AttemptData[]): Rate {
  const called = attempts.filter((a) => a.result !== "PENDING" && a.weight !== null);
  return { made: called.filter((a) => a.result === "GOOD").length, called: called.length };
}

/** Openers, seconds and thirds across every meet: how many went. */
export function ratesByNumber(meets: Pick<MeetData, "attempts">[]): Rate[] {
  const all = meets.flatMap((m) => m.attempts);
  return [1, 2, 3].map((n) => rate(all.filter((a) => a.number === n)));
}

/** Each lift's thirds across every meet. */
export function thirdsByLift(meets: Pick<MeetData, "attempts">[]): Record<MeetLift, Rate> {
  const thirds = meets.flatMap((m) => m.attempts).filter((a) => a.number === 3);
  return {
    SQUAT: rate(thirds.filter((a) => a.lift === "SQUAT")),
    BENCH: rate(thirds.filter((a) => a.lift === "BENCH")),
    DEADLIFT: rate(thirds.filter((a) => a.lift === "DEADLIFT")),
  };
}

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

/** The competition page's tabs: the attempts, the weeks leading up to the meet, and every meet so far. */
export type CompetitionTab = "attempts" | "road" | "history";

export const COMPETITION_TABS: CompetitionTab[] = ["attempts", "road", "history"];

export function competitionHref(athleteId: string, meetId: string | null, tab: CompetitionTab = "attempts") {
  return `/competition?athlete=${athleteId}${meetId ? `&meet=${meetId}` : ""}${tab === "attempts" ? "" : `&tab=${tab}`}`;
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
