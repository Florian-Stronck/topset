import { cache } from "react";
import { formatPrescription, formatRamp, maxesOf, resolveDay } from "@/lib/intensity";
import { bodyweightEntry } from "@/lib/bodyweight";
import { prisma } from "@/lib/prisma";
import { answerDay, asksOn, questionData, type CheckinAnswerData, type CheckinQuestionData } from "@/lib/checkins";
import { sessionsOf, type Session } from "@/lib/schedule";
import type { SetLogData } from "@/lib/setlog";

/**
 * Reads for the athlete app. Everything here starts from the athlete's access token, so
 * a link only ever opens its own athlete's plan.
 */

/** A token is long and random; anything short is not worth a database round trip. */
export function plausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{24,64}$/.test(token);
}

/** Once per request: the layout and the page both ask. */
export const getAthleteByToken = cache(async (token: string) => {
  if (!plausibleToken(token)) return null;
  return prisma.athlete.findUnique({
    // A coach the admin turned off takes their athletes' links with them.
    where: { accessToken: token, coach: { disabledAt: null } },
    select: { id: true, coachId: true, name: true, unit: true, squat1RM: true, bench1RM: true, dead1RM: true },
  });
});

export type TokenAthlete = NonNullable<Awaited<ReturnType<typeof getAthleteByToken>>>;

/**
 * Every phase of every program, down to its days but not what is in them: enough to lay
 * out the calendar. The rows of a day are read only for the days a page shows.
 */
async function phasesFor(athleteId: string) {
  return prisma.block.findMany({
    where: { athleteId },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      phase: true,
      startDate: true,
      squat1RM: true,
      bench1RM: true,
      dead1RM: true,
      program: { select: { name: true } },
      weeks: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          days: { orderBy: { index: "asc" }, select: { id: true, index: true, label: true, rest: true } },
        },
      },
    },
  });
}

type Phase = Awaited<ReturnType<typeof phasesFor>>[number];
type PhaseDay = Phase["weeks"][number]["days"][number];
export type ScheduledSession = Session<Phase, PhaseDay>;

/** The rows of these days, each with its logged sets. */
function rowsOf(dayIds: string[]) {
  return prisma.exerciseRow.findMany({
    where: { dayId: { in: dayIds } },
    orderBy: { order: "asc" },
    include: { logs: { orderBy: { setIndex: "asc" } } },
  });
}

type DayRow = Awaited<ReturnType<typeof rowsOf>>[number];

/** One exercise as the athlete sees it: what to do, set by set, and what they logged. */
export type AthleteRow = {
  id: string;
  exercise: string;
  target: string;
  sets: number | null;
  reps: number | null;
  /** "RPE 8", "75%", "top −10%" — as the coach wrote it. */
  prescription: string;
  ramp: string | null;
  /** The load for each prescribed set, when it can be worked out. */
  loads: (number | null)[];
  tempo: string | null;
  restTime: string | null;
  coachNotes: string | null;
  videoUrl: string | null;
  athleteNotes: string | null;
  logs: SetLogData[];
};

export type AthleteSession = {
  ymd: string;
  dayId: string;
  label: string;
  program: string;
  phase: string;
  week: number;
  rows: AthleteRow[];
  /** Prescribed sets across the day, and how many are checked off. */
  prescribed: number;
  done: number;
};

function toSession(s: ScheduledSession, dayRows: DayRow[], athlete: TokenAthlete): AthleteSession {
  const maxes = maxesOf(s.block, athlete);
  const rows = dayRows.filter((r) => r.exercise.trim() !== "");
  const resolved = resolveDay(dayRows, maxes);

  const out: AthleteRow[] = rows.map((row) => {
    const r = resolved.get(row.id);
    const count = Math.max(1, row.sets ?? 1);
    const loads = Array.from({ length: count }, (_, i) => r?.ramp[i] ?? r?.weight ?? null);
    return {
      id: row.id,
      exercise: row.exercise,
      target: row.target,
      sets: row.sets,
      reps: row.reps,
      prescription: formatPrescription(row, athlete.unit),
      ramp: formatRamp(row, athlete.unit),
      loads,
      tempo: row.tempo,
      restTime: row.restTime,
      coachNotes: row.coachNotes,
      videoUrl: row.videoUrl,
      athleteNotes: row.athleteNotes,
      logs: row.logs.map((log) => ({ ...log, loggedAt: log.loggedAt.toISOString() })),
    };
  });

  return {
    ymd: s.ymd,
    dayId: s.day.id,
    label: s.day.label,
    program: s.block.program.name,
    phase: s.block.phase,
    week: s.week,
    rows: out,
    prescribed: out.reduce((n, r) => n + Math.max(1, r.sets ?? 1), 0),
    done: out.reduce((n, r) => n + r.logs.filter((l) => l.done).length, 0),
  };
}

export type SchedulePhase = Phase;

/** The athlete's whole calendar of training days, oldest first — dates only. */
export async function getAthleteSchedule(athlete: TokenAthlete): Promise<ScheduledSession[]> {
  return (await getAthleteCalendar(athlete)).sessions;
}

/** The calendar with the phases it was laid out from, rest weeks and all. */
export async function getAthleteCalendar(athlete: TokenAthlete): Promise<{ phases: Phase[]; sessions: ScheduledSession[] }> {
  const phases = await phasesFor(athlete.id);
  return { phases, sessions: sessionsOf<PhaseDay, Phase>(phases) };
}

/** These days of the calendar in full: what to do, and what has been logged. */
export async function sessionsInFull(athlete: TokenAthlete, sessions: ScheduledSession[]): Promise<AthleteSession[]> {
  if (sessions.length === 0) return [];
  const byDay = new Map<string, DayRow[]>();
  for (const row of await rowsOf(sessions.map((s) => s.day.id))) {
    byDay.set(row.dayId, [...(byDay.get(row.dayId) ?? []), row]);
  }
  return sessions.map((s) => toSession(s, byDay.get(s.day.id) ?? [], athlete));
}

/** Whether a row belongs to the athlete holding this token — the check before any write. */
export async function rowForToken(token: string, rowId: string) {
  if (!plausibleToken(token)) return null;
  return prisma.exerciseRow.findFirst({
    where: { id: rowId, day: { week: { block: { athlete: { accessToken: token, coach: { disabledAt: null } } } } } },
    select: { id: true, sets: true },
  });
}

/** The athlete's latest weigh-ins, newest first, as the app shows them. */
export async function recentBodyweight(athleteId: string, take = 30) {
  const rows = await prisma.bodyweightLog.findMany({
    where: { athleteId, deletedAt: null },
    orderBy: [{ day: "desc" }, { createdAt: "desc" }],
    take,
    select: { id: true, day: true, weight: true, note: true, source: true, createdAt: true },
  });
  return rows.map(bodyweightEntry);
}

export type DayCheckin = { questions: CheckinQuestionData[]; answers: CheckinAnswerData[] };

/** The check-in questions asked on a day, in the coach's order, with any answers given. */
export async function checkinOn(athleteId: string, day: string): Promise<DayCheckin> {
  const rows = await prisma.checkinQuestion.findMany({ where: { athleteId, archived: false }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const questions = rows.map(questionData).filter((q) => asksOn(q, day));
  if (questions.length === 0) return { questions, answers: [] };
  const answers = await prisma.checkinAnswer.findMany({
    where: {
      deletedAt: null,
      OR: questions.map((q) => ({ questionId: q.id, day: answerDay(q, day) })),
    },
    select: { id: true, questionId: true, day: true, value: true },
  });
  return { questions, answers };
}

/** A note from the coach as the athlete app shows it, with the session it is about. */
export type InboxMessage = {
  id: string;
  day: string;
  /** The session's name, when its day still exists. */
  label: string | null;
  body: string;
  read: boolean;
  createdAt: string;
};

/** The coach's notes to this athlete, newest first — all of them, or those about some days. */
export async function inboxFor(athleteId: string, days?: string[]): Promise<InboxMessage[]> {
  const rows = await prisma.coachMessage.findMany({
    where: { athleteId, deletedAt: null, ...(days ? { day: { in: days } } : {}) },
    orderBy: [{ day: "desc" }, { createdAt: "desc" }],
  });
  const dayIds = [...new Set(rows.map((r) => r.dayId).filter((id): id is string => id !== null))];
  const labels = new Map(
    dayIds.length ? (await prisma.day.findMany({ where: { id: { in: dayIds } }, select: { id: true, label: true } })).map((d) => [d.id, d.label]) : [],
  );
  return rows.map((r) => ({
    id: r.id,
    day: r.day,
    label: r.dayId ? (labels.get(r.dayId) ?? null) : null,
    body: r.body,
    read: r.readAt !== null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** How many of the coach's notes the athlete hasn't opened yet. */
export async function unreadCount(athleteId: string): Promise<number> {
  return prisma.coachMessage.count({ where: { athleteId, deletedAt: null, readAt: null } });
}
