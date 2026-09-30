import { cache } from "react";
import { formatPrescription, formatRamp, maxesOf, resolveDay } from "@/lib/intensity";
import { bodyweightEntry } from "@/lib/bodyweight";
import { prisma } from "@/lib/prisma";
import { ymdOf } from "@/lib/dates";
import { answerDay, asksOn, nutrientOf, questionData, type CheckinAnswerData, type CheckinQuestionData, type PhotoView } from "@/lib/checkins";
import { nutritionId, targetOn, targetSpan, type NutritionTarget, type TargetSpan } from "@/lib/nutrition";
import { byWhen, meetingData, type MeetingData } from "@/lib/meetings";
import { moveData, movesMap, type MoveData } from "@/lib/moves";
import { sessionsOf, type Session } from "@/lib/schedule";
import type { SetLogData } from "@/lib/setlog";
import { retentionDays, type ClipView } from "@/lib/athlete-videos";
import { presign, storageConfig } from "@/lib/storage";

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
    select: { id: true, coachId: true, name: true, unit: true, sport: true, squat1RM: true, bench1RM: true, dead1RM: true },
  });
});

export type TokenAthlete = NonNullable<Awaited<ReturnType<typeof getAthleteByToken>>>;

/** The athlete behind a viewer link: a read-only Tracking for a second coach. */
export const getAthleteByViewToken = cache(async (token: string) => {
  if (!plausibleToken(token)) return null;
  return prisma.athlete.findUnique({
    where: { viewToken: token, coach: { disabledAt: null } },
    select: { id: true, coachId: true, name: true, unit: true, sport: true, squat1RM: true, bench1RM: true, dead1RM: true },
  });
});

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
  /** The top of a rep range; null for a single number. */
  repsMax: number | null;
  /** Seconds per set, for a timed row. */
  duration: number | null;
  /** Which of the day's sessions it is in; null when the day has one. */
  session: string | null;
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
  /** Videos the athlete sent of it; null when the server has nowhere to keep videos. */
  videos: ClipView[] | null;
};

export type AthleteSession = {
  ymd: string;
  /** Where the plan put it, when the athlete moved it. */
  movedFrom: string | null;
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

function toSession(s: ScheduledSession, dayRows: DayRow[], athlete: TokenAthlete, clips: Map<string, ClipView[]> | null): AthleteSession {
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
      repsMax: row.repsMax,
      duration: row.duration,
      session: row.session,
      prescription: formatPrescription(row, athlete.unit),
      ramp: formatRamp(row, athlete.unit),
      loads,
      tempo: row.tempo,
      restTime: row.restTime,
      coachNotes: row.coachNotes,
      videoUrl: row.videoUrl,
      athleteNotes: row.athleteNotes,
      logs: row.logs.map((log) => ({ ...log, loggedAt: log.loggedAt.toISOString() })),
      videos: clips ? (clips.get(row.id) ?? []) : null,
    };
  });

  return {
    ymd: s.ymd,
    movedFrom: s.movedFrom ?? null,
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

/** The calendar with the phases it was laid out from, rest weeks and all, and the sessions moved. */
export async function getAthleteCalendar(athlete: TokenAthlete): Promise<{ phases: Phase[]; sessions: ScheduledSession[] }> {
  const [phases, moves] = await Promise.all([phasesFor(athlete.id), movesFor(athlete.id)]);
  return { phases, sessions: sessionsOf<PhaseDay, Phase>(phases, movesMap(moves)) };
}

/** The sessions the athlete moved and hasn't moved back. */
export async function movesFor(athleteId: string): Promise<MoveData[]> {
  const rows = await prisma.sessionMove.findMany({ where: { athleteId, deletedAt: null }, orderBy: { day: "asc" } });
  return rows.map(moveData);
}

/** Every meeting on file that is still standing, soonest first. */
export async function meetingsFor(athleteId: string): Promise<MeetingData[]> {
  const rows = await prisma.meeting.findMany({ where: { athleteId, deletedAt: null } });
  return rows.map(meetingData).sort(byWhen);
}

/** These days of the calendar in full: what to do, and what has been logged. */
export async function sessionsInFull(athlete: TokenAthlete, sessions: ScheduledSession[]): Promise<AthleteSession[]> {
  if (sessions.length === 0) return [];
  const byDay = new Map<string, DayRow[]>();
  const rows = await rowsOf(sessions.map((s) => s.day.id));
  for (const row of rows) {
    byDay.set(row.dayId, [...(byDay.get(row.dayId) ?? []), row]);
  }
  const clips = await clipsOf(athlete.id, rows.map((r) => r.id));
  return sessions.map((s) => toSession(s, byDay.get(s.day.id) ?? [], athlete, clips));
}

/** How long a link to play a video works: long enough for a session at the gym. */
const PLAY_LINK_SECONDS = 6 * 60 * 60;

/**
 * The videos still in storage for these rows, each with a link to play it, per row; null
 * when the server has no bucket. Links are signed here, with no call to storage.
 */
async function clipsOf(athleteId: string, rowIds: string[]): Promise<Map<string, ClipView[]> | null> {
  const config = storageConfig();
  if (!config) return null;
  const out = new Map<string, ClipView[]>();
  if (rowIds.length === 0) return out;
  const keep = retentionDays();
  const since = new Date(Date.now() - keep * 86_400_000);
  const rows = await prisma.athleteVideo.findMany({
    where: { athleteId, rowId: { in: rowIds }, deletedAt: null, uploadedAt: { gt: since } },
    orderBy: { uploadedAt: "asc" },
  });
  for (const v of rows) {
    const uploaded = v.uploadedAt ?? v.createdAt;
    const view: ClipView = {
      id: v.id,
      name: v.name,
      setIndex: v.setIndex,
      size: v.size,
      uploadedAt: uploaded.toISOString(),
      url: presign(config, { method: "GET", key: v.storageKey, expiresIn: PLAY_LINK_SECONDS }),
      daysLeft: Math.max(0, Math.ceil((uploaded.getTime() + keep * 86_400_000 - Date.now()) / 86_400_000)),
    };
    out.set(v.rowId, [...(out.get(v.rowId) ?? []), view]);
  }
  return out;
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

export type DayCheckin = {
  questions: CheckinQuestionData[];
  answers: CheckinAnswerData[];
  /** Photos on the answers; empty when the server has no bucket. */
  photos: PhotoView[];
  /** Whether photos can be sent at all. */
  photosOn: boolean;
  /** The phase's nutrition targets for the day, when the check-in asks about nutrition. */
  target: NutritionTarget | null;
};

/**
 * The check-in questions asked on a day, in the coach's order, with any answers given. The
 * nutrition questions' answers are read from the nutrition log, where they are kept.
 */
export async function checkinOn(athleteId: string, day: string): Promise<DayCheckin> {
  const config = storageConfig();
  const rows = await prisma.checkinQuestion.findMany({ where: { athleteId, archived: false }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const questions = rows.map(questionData).filter((q) => asksOn(q, day));
  if (questions.length === 0) return { questions, answers: [], photos: [], photosOn: config !== null, target: null };
  const where = questions.map((q) => ({ questionId: q.id, day: answerDay(q, day) }));
  const [answers, nutrition, photos] = await Promise.all([
    prisma.checkinAnswer.findMany({ where: { deletedAt: null, OR: where }, select: { id: true, questionId: true, day: true, value: true } }),
    prisma.nutritionLog.findMany({ where: { id: { in: questions.map((q) => nutritionId(athleteId, answerDay(q, day))) }, deletedAt: null } }),
    config && questions.some((q) => q.config.photo)
      ? prisma.checkinPhoto.findMany({ where: { athleteId, deletedAt: null, uploadedAt: { not: null }, OR: where }, orderBy: { createdAt: "asc" } })
      : [],
  ]);
  for (const q of questions) {
    const n = nutrientOf(q);
    const filed = answerDay(q, day);
    const row = n && nutrition.find((r) => r.day === filed);
    if (n && row && row[n] !== null) answers.push({ id: `${row.id}-${n}`, questionId: q.id, day: filed, value: String(row[n]) });
  }
  return {
    questions,
    answers,
    photos: photos.map((p) => ({
      id: p.id,
      questionId: p.questionId,
      day: p.day,
      url: presign(config!, { method: "GET", key: p.storageKey, expiresIn: PLAY_LINK_SECONDS }),
    })),
    photosOn: config !== null,
    target: questions.some((q) => nutrientOf(q)) ? targetOn(await targetSpans(athleteId), day) : null,
  };
}

/** The athlete's phases that set nutrition targets, as spans of days. */
async function targetSpans(athleteId: string): Promise<TargetSpan[]> {
  const phases = await prisma.block.findMany({
    where: { athleteId },
    select: { startDate: true, kcalTarget: true, proteinTarget: true, carbsTarget: true, fatTarget: true, _count: { select: { weeks: true } } },
  });
  return phases.map((p) => targetSpan({ ...p, weeks: p._count.weeks })).filter((s): s is TargetSpan => s !== null);
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

/** How many of the coach's notes the athlete hasn't opened yet, and meetings waiting on their answer. */
export async function unreadCount(athleteId: string, today?: string): Promise<number> {
  const [notes, meetings] = await Promise.all([
    prisma.coachMessage.count({ where: { athleteId, deletedAt: null, readAt: null } }),
    prisma.meeting.count({
      where: { athleteId, deletedAt: null, status: "PROPOSED", proposedBy: "coach", ...(today ? { day: { gte: today } } : {}) },
    }),
  ]);
  return notes + meetings;
}

/** A competition as the athlete app's calendar shows it. */
export type AthleteMeet = {
  id: string;
  ymd: string;
  name: string;
  federation: string | null;
  weightClass: string | null;
  attempts: { lift: "SQUAT" | "BENCH" | "DEADLIFT"; number: number; weight: number | null; result: "PENDING" | "GOOD" | "MISS" }[];
};

/** The athlete's competitions, oldest first, with their attempts. */
export async function meetsFor(athleteId: string): Promise<AthleteMeet[]> {
  const rows = await prisma.meet.findMany({
    where: { athleteId },
    orderBy: { date: "asc" },
    include: { attempts: { orderBy: [{ lift: "asc" }, { number: "asc" }] } },
  });
  return rows.map((m) => ({
    id: m.id,
    ymd: ymdOf(m.date),
    name: m.name,
    federation: m.federation,
    weightClass: m.weightClass,
    attempts: m.attempts.map((a) => ({ lift: a.lift, number: a.number, weight: a.weight, result: a.result })),
  }));
}
