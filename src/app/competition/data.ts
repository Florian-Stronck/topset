import type { MeetLift } from "@prisma/client";
import { weightToMake } from "@/lib/bodyweight";
import { daysUntil, MEET_LIFTS, maxFor, parseRacks, rackFor, type CompetitionTab, type MeetData, type TaskOwner } from "@/lib/competition";
import { today as calendarToday, weekStartOf, ymdOf } from "@/lib/dates";
import { liftOf, maxesOf, resolveDay } from "@/lib/intensity";
import type { TrainingSession } from "@/lib/overview";
import type { LiftKey } from "@/lib/progress";
import { prisma } from "@/lib/prisma";
import { parseReminders } from "@/lib/meet-reminders";
import { getBodyweights, getCheckins, getMeetsForAthlete, getTrainingWindow } from "@/lib/queries";
import { liftTrends, weeklyE1rm, weeklyReadiness, weekStarts } from "@/lib/roster";
import { addDays, programOn } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";
import { readinessSeries, topSetOf } from "@/lib/tracking";
import type { AthleteData } from "@/lib/types";

const KEY: Record<MeetLift, LiftKey> = { SQUAT: "squat", BENCH: "bench", DEADLIFT: "dead" };
const LIFT: Record<LiftKey, MeetLift> = { squat: "SQUAT", bench: "BENCH", dead: "DEADLIFT" };

/** How far back the e1RM sparkline and the opener check look. */
const SPARK_WEEKS = 8;
const HEAVIEST_DAYS = 42;
/** A day with a main lift at this share of its max or more counts as heavy. */
const HEAVY = 0.9;

export type TopSet = { weight: number; reps: number | null; rpe: number | null; ymd: string };

/** What training says about the meet: plain data, so it can cross to the client. */
export type TrainingFacts = {
  /** Best estimated 1RM of the last four weeks. */
  e1rm: Record<MeetLift, number | null>;
  /** The best e1RM of each of the last weeks, oldest first. */
  weekly: Record<MeetLift, (number | null)[]>;
  /** The heaviest set finished in the last six weeks. */
  heaviest: Record<MeetLift, TopSet | null>;
};

export type RoadWeek = {
  start: string;
  /** Each lift's heaviest set that week: logged where it was, planned where it wasn't yet. */
  top: Record<MeetLift, { weight: number; pct: number | null; logged: boolean } | null>;
  readiness: number | null;
};

/** The program the meet is the end of, week by week. */
export type Road = {
  program: string;
  /** Where to open it in Programming. */
  href: string;
  weeks: RoadWeek[];
  phases: { name: string; from: number; weeks: number }[];
  /** The week the meet falls in; `weeks.length` when it comes after the program ends. */
  meetWeek: number | null;
  todayWeek: number | null;
  /** The last day before the meet with a main lift at 90% of its max or more. */
  lastHeavy: { ymd: string; lift: MeetLift; weight: number } | null;
};

/** The main lift a row trains, if it is one: competition squat, bench or deadlift, not a variation. */
function mainLift(row: TrainingSession["rows"][number]): MeetLift | null {
  if (row.tier !== "PRIMARY") return null;
  const lift = liftOf(row.target);
  return lift ? LIFT[lift] : null;
}

export async function loadTraining(athlete: AthleteData): Promise<TrainingFacts> {
  const today = ymdOf(calendarToday());
  const weeks = weekStarts(weekStartOf(today, activeSettings().weekStart), SPARK_WEEKS);
  const sessions = (await getTrainingWindow([athlete.id], weeks[0], today)).get(athlete.id) ?? [];
  const trends = liftTrends(sessions, today, athlete.unit, athlete.rpeTable);
  const weekly = weeklyE1rm(sessions, weeks, today, athlete.unit, athlete.rpeTable);

  const heaviest: Record<MeetLift, TopSet | null> = { SQUAT: null, BENCH: null, DEADLIFT: null };
  const from = addDays(today, -(HEAVIEST_DAYS - 1));
  for (const s of sessions) {
    if (s.ymd < from || s.ymd > today) continue;
    for (const row of s.rows) {
      const lift = mainLift(row);
      const top = lift ? topSetOf(row) : null;
      if (!lift || !top) continue;
      const was = heaviest[lift];
      if (!was || top.weight > was.weight || (top.weight === was.weight && (top.reps ?? 0) > (was.reps ?? 0))) {
        heaviest[lift] = { ...top, ymd: s.ymd };
      }
    }
  }

  const byLift = <T,>(pick: (key: LiftKey) => T) => Object.fromEntries(MEET_LIFTS.map((l) => [l, pick(KEY[l])])) as Record<MeetLift, T>;
  return { e1rm: byLift((k) => trends[k].e1rm), weekly: byLift((k) => weekly[k]), heaviest };
}

export async function loadRoad(athlete: AthleteData, meetDate: string): Promise<Road | null> {
  const today = ymdOf(calendarToday());
  const meetYmd = meetDate.slice(0, 10);
  const blocks = await prisma.block.findMany({
    where: { athleteId: athlete.id },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      programId: true,
      phase: true,
      startDate: true,
      squat1RM: true,
      bench1RM: true,
      dead1RM: true,
      program: { select: { name: true } },
      _count: { select: { weeks: true } },
    },
  });
  const spans = blocks.map((b) => ({ programId: b.programId, startDate: b.startDate, weeks: b._count.weeks }));
  // The program running into the meet; failing that, the one running now.
  const programId = programOn(spans, addDays(meetYmd, -1), athlete.activeProgramId) ?? programOn(spans, today, athlete.activeProgramId);
  const mine = blocks.filter((b) => b.programId === programId && b._count.weeks > 0);
  if (!programId || mine.length === 0) return null;

  const phases: Road["phases"] = [];
  const starts: string[] = [];
  for (const b of mine) {
    phases.push({ name: b.phase, from: starts.length, weeks: b._count.weeks });
    for (let w = 0; w < b._count.weeks; w++) starts.push(addDays(ymdOf(b.startDate), 7 * w));
  }
  const end = addDays(starts[starts.length - 1], 7);
  const weekOf = (ymd: string) => {
    const i = starts.findIndex((s) => ymd >= s && ymd < addDays(s, 7));
    return i >= 0 ? i : null;
  };

  const [window, checkins] = await Promise.all([getTrainingWindow([athlete.id], starts[0], addDays(end, -1)), getCheckins([athlete.id], starts[0])]);
  const sessions = (window.get(athlete.id) ?? []).filter((s) => mine.some((b) => b.id === s.blockId));

  const tops: RoadWeek["top"][] = starts.map(() => ({ SQUAT: null, BENCH: null, DEADLIFT: null }));
  let lastHeavy: Road["lastHeavy"] = null;
  for (const s of sessions) {
    const i = weekOf(s.ymd);
    const block = mine.find((b) => b.id === s.blockId);
    if (i === null || !block) continue;
    const maxes = maxesOf(block, athlete);
    const resolved = resolveDay(s.rows, maxes);
    let heavy: Road["lastHeavy"] = null;
    for (const row of s.rows) {
      const lift = mainLift(row);
      if (!lift) continue;
      const logged = topSetOf(row);
      const weight = logged?.weight ?? resolved.get(row.id)?.weight ?? null;
      if (weight === null) continue;
      const max = maxFor(lift, maxes);
      const was = tops[i][lift];
      if (!was || weight > was.weight) tops[i][lift] = { weight, pct: max ? Math.round((weight / max) * 100) : null, logged: logged !== null };
      if (max && weight >= max * HEAVY && (!heavy || weight / max > heavy.weight / (maxFor(heavy.lift, maxes) ?? weight))) heavy = { ymd: s.ymd, lift, weight };
    }
    if (heavy && s.ymd < meetYmd && (!lastHeavy || s.ymd >= lastHeavy.ymd)) lastHeavy = heavy;
  }

  const answers = checkins.get(athlete.id);
  const readiness = answers ? weeklyReadiness(readinessSeries(answers.questions, answers.answers, starts[0], today), starts) : starts.map(() => null);

  return {
    program: mine[0].program.name,
    href: `/programming?athlete=${athlete.id}&phase=${mine[0].id}`,
    weeks: starts.map((start, i) => ({ start, top: tops[i], readiness: readiness[i] })),
    phases,
    meetWeek: meetYmd >= end ? starts.length : weekOf(meetYmd),
    todayWeek: weekOf(today),
    lastHeavy,
  };
}

/**
 * Everything MeetPlanner shows for one athlete: their meets, the one on show (the one
 * picked, else the next, else the latest) and what its tab needs. The Competition screen
 * and the coach's phone both lay it out.
 */
export async function plannerData(athlete: AthleteData, picked: string | undefined, tab: CompetitionTab) {
  const [meets, weights, tasks, link] = await Promise.all([
    getMeetsForAthlete(athlete.id),
    getBodyweights([athlete.id]),
    prisma.meetTask.findMany({ where: { athleteId: athlete.id, deletedAt: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    prisma.athlete.findUnique({ where: { id: athlete.id }, select: { accessToken: true, racks: true } }),
  ]);
  const entries = weights.get(athlete.id) ?? [];
  const racks = parseRacks(link?.racks);

  const data: MeetData[] = meets.map((meet) => ({
    id: meet.id,
    name: meet.name,
    federation: meet.federation,
    weightClass: meet.weightClass,
    // Weighed in on the phone: the last weigh-in logged that day counts until the coach writes one.
    bodyweight: meet.bodyweight ?? entries.findLast((e) => e.day === (meet.weighInDay ?? ymdOf(meet.date)))?.weight ?? null,
    date: meet.date.toISOString(),
    goal: meet.goal,
    venue: meet.venue,
    weighInDay: meet.weighInDay,
    weighInTime: meet.weighInTime,
    startTime: meet.startTime,
    session: meet.session,
    rackBrand: meet.rackBrand,
    racks: rackFor(racks, meet.rackBrand),
    shared: meet.shared,
    shareAttempts: meet.shareAttempts,
    reminders: parseReminders(meet.reminders),
    tasks: tasks
      .filter((x) => x.meetId === meet.id)
      .map((x) => ({ id: x.id, text: x.text, owner: x.owner as TaskOwner, done: x.done, doneBy: x.doneBy as TaskOwner | null, updatedAt: x.updatedAt.toISOString() })),
    attempts: meet.attempts.map((a) => ({
      id: a.id,
      lift: a.lift,
      number: a.number,
      weight: a.weight,
      result: a.result,
    })),
  }));

  // With nothing picked, the next meet — or the latest one if they are all behind.
  const now = new Date();
  const meet =
    data.find((m) => m.id === picked) ??
    data.find((m) => daysUntil(m.date, now) >= 0) ??
    data.findLast((m) => daysUntil(m.date, now) < 0) ??
    null;
  const [training, road] = await Promise.all([
    tab === "attempts" && meet ? loadTraining(athlete) : null,
    tab === "road" && meet ? loadRoad(athlete, meet.date) : null,
  ]);

  return {
    meets: data,
    meet,
    tab,
    training,
    road,
    today: now.toISOString(),
    calendarDay: ymdOf(calendarToday()),
    bodyweights: entries,
    linked: Boolean(link?.accessToken),
    racks,
    limits: Object.fromEntries(meets.map((m) => [m.id, weightToMake(m)])),
  };
}
