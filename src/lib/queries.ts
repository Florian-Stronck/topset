import { bodyweightEntry } from "@/lib/bodyweight";
import { currentBlock, type AthleteSummary, type WindowSession } from "@/lib/overview";
import { isBodyweight, nutrientOf, questionData, type CheckinAnswerData, type CheckinQuestionData } from "@/lib/checkins";
import { nutritionEntry, targetSpan, type NutritionEntry, type TargetSpan } from "@/lib/nutrition";
import { photosHere } from "@/lib/photos";
import { injuryData, type InjuryData } from "@/lib/injuries";
import type { TimedRow } from "@/lib/load";
import { byWhen, meetingData, type MeetingData } from "@/lib/meetings";
import { moveData, movesMap, type MoveData } from "@/lib/moves";
import { dateOfDay, sessionsOf } from "@/lib/schedule";
import { prisma } from "@/lib/prisma";
import type { BlockData } from "@/lib/types";
import { myCoach } from "@/lib/me";

export async function getCoach() {
  const coach = await prisma.coach.findFirst({ where: await myCoach() });
  if (!coach) throw new Error("No coach found — run `npm run db:seed`.");
  // Everyone here: the coach's own athletes and those shared with them through a team.
  const athletes = await prisma.athlete.findMany({ orderBy: { name: "asc" }, include: { team: { select: { name: true } } } });
  return { ...coach, athletes };
}

const PHASE_SUMMARY = {
  id: true,
  phase: true,
  order: true,
  // Enough of each week to number the tabs; the grid loads the one it is showing.
  weeks: { select: { id: true, order: true, locked: true }, orderBy: { order: "asc" as const } },
  startDate: true,
  squat1RM: true,
  bench1RM: true,
  dead1RM: true,
  kcalTarget: true,
  proteinTarget: true,
  carbsTarget: true,
  fatTarget: true,
} as const;

/** Every program the athlete has, each with its phases in order. */
export async function getProgramsForAthlete(athleteId: string) {
  return prisma.program.findMany({
    where: { athleteId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      phases: { orderBy: { order: "asc" }, select: PHASE_SUMMARY },
    },
  });
}


export type ProgramSummary = Awaited<ReturnType<typeof getProgramsForAthlete>>[number];
export type PhaseSummary = ProgramSummary["phases"][number];

/**
 * What a workspace screen needs: the athlete's programs, whichever one is open, and the
 * full grid of the phase inside it. A phase id alone is enough — its program is found
 * from it — so a link does not have to carry both.
 */
export async function getWorkspace(athleteId: string, programId?: string, phaseId?: string) {
  const programs = await getProgramsForAthlete(athleteId);

  const program =
    programs.find((p) => p.id === programId) ??
    programs.find((p) => p.phases.some((phase) => phase.id === phaseId)) ??
    programs[0] ??
    null;

  const summary =
    program?.phases.find((phase) => phase.id === phaseId) ?? program?.phases[0] ?? null;

  const phase = summary
    ? await prisma.block.findUniqueOrThrow({ where: { id: summary.id }, include: BLOCK_INCLUDE })
    : null;

  return { programs, program, phase };
}

const BLOCK_INCLUDE = {
  athlete: true,
  program: { select: { id: true, name: true } },
  weeks: {
    orderBy: { order: "asc" as const },
    include: {
      days: {
        orderBy: { index: "asc" as const },
        include: {
          rows: {
            orderBy: { order: "asc" as const },
            include: {
              rules: { orderBy: { order: "asc" as const } },
              logs: { orderBy: { setIndex: "asc" as const } },
            },
          },
        },
      },
    },
  },
};

/** Every phase of a program, each fully loaded — the sheet view of the whole program. */
export async function getProgramBlocks(programId: string) {
  return prisma.block.findMany({
    where: { programId },
    orderBy: { order: "asc" },
    include: BLOCK_INCLUDE,
  });
}

/** The phase as the client components want it: dates as strings, nothing else changed. */
export function toBlockData(phase: BlockWithDays): BlockData {
  return {
    id: phase.id,
    phase: phase.phase,
    program: phase.program,
    order: phase.order,
    startDate: phase.startDate.toISOString(),
    squat1RM: phase.squat1RM,
    bench1RM: phase.bench1RM,
    dead1RM: phase.dead1RM,
    weeks: phase.weeks.map((week) => ({
      id: week.id,
      order: week.order,
      locked: week.locked,
      days: week.days.map((day) => ({
        id: day.id,
        index: day.index,
        label: day.label,
        rest: day.rest,
        reviewedAt: day.reviewedAt?.toISOString() ?? null,
        rows: day.rows.map((row) => ({
          ...row,
          logs: row.logs.map((log) => ({ ...log, loggedAt: log.loggedAt.toISOString() })),
        })),
      })),
    })),
  };
}

export type BlockWithDays = NonNullable<Awaited<ReturnType<typeof getWorkspace>>["phase"]>;
export type WeekWithDays = BlockWithDays["weeks"][number];
export type DayWithRows = WeekWithDays["days"][number];
export type RowWithRules = DayWithRows["rows"][number];

/** Every exercise name this coach has already programmed, for the EXERCISE autocomplete. */
export async function getExerciseHistory(coachId: string) {
  const rows = await prisma.exerciseRow.findMany({
    where: { day: { week: { block: { athlete: { coachId } } } } },
    select: { exercise: true },
    distinct: ["exercise"],
    orderBy: { exercise: "asc" },
  });
  return rows.map((r) => r.exercise).filter((name) => name.trim() !== "");
}

/**
 * Everything the overview reads: the roster, every block, and — for the block each
 * athlete is on today — the TARGET/tier pairs the missing-1RM check needs.
 */
export async function getOverview(today: Date) {
  const coach = await prisma.coach.findFirst({ where: await myCoach() });
  if (!coach) throw new Error("No coach found — run `npm run db:seed`.");

  const rows = await prisma.athlete.findMany({
    // The coach's own athletes and those shared with them: everyone here.
    orderBy: { name: "asc" },
    include: {
      blocks: {
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          phase: true,
          startDate: true,
          squat1RM: true,
          bench1RM: true,
          dead1RM: true,
          program: { select: { id: true, name: true } },
          _count: { select: { weeks: true } },
          // Weeks can differ now, so the shape of the first one stands for the phase.
          weeks: {
            orderBy: { order: "asc" },
            take: 1,
            select: {
              days: { select: { rest: true, rows: { select: { exercise: true } } } },
            },
          },
        },
      },
    },
  });

  const athletes: AthleteSummary[] = rows.map((athlete) => ({
    id: athlete.id,
    name: athlete.name,
    unit: athlete.unit,
    sport: athlete.sport,
    squat1RM: athlete.squat1RM,
    bench1RM: athlete.bench1RM,
    dead1RM: athlete.dead1RM,
    blocks: athlete.blocks.map((block) => {
      const first = block.weeks[0];
      return {
        id: block.id,
        programId: block.program.id,
        name: block.program.name,
        phase: block.phase,
        startDate: block.startDate,
        weeks: block._count.weeks,
        squat1RM: block.squat1RM,
        bench1RM: block.bench1RM,
        dead1RM: block.dead1RM,
        trainingDays: first ? first.days.filter((d) => !d.rest).length : 0,
        rows: first
          ? first.days.reduce(
              (n, day) => n + day.rows.filter((r) => r.exercise.trim() !== "").length,
              0,
            )
          : 0,
      };
    }),
  }));

  const currentIds = athletes
    .map((a) => currentBlock(a.blocks, today)?.id)
    .filter((id): id is string => id !== undefined);

  const currentRows = await prisma.exerciseRow.findMany({
    where: { day: { week: { blockId: { in: currentIds } } } },
    select: { tier: true, target: true, day: { select: { week: { select: { blockId: true } } } } },
  });

  const targetsByBlock = new Map<string, { target: string; tier: string }[]>();
  for (const row of currentRows) {
    const blockId = row.day.week.blockId;
    const list = targetsByBlock.get(blockId) ?? [];
    list.push({ target: row.target, tier: row.tier });
    targetsByBlock.set(blockId, list);
  }

  // Who has a check-in link out; the link itself stays on the Athletes page.
  const linked = new Set(rows.filter((a) => a.accessToken !== null).map((a) => a.id));

  return { coach, athletes, targetsByBlock, linked };
}

/** Meets for one athlete, soonest first, with their nine attempts in lift order. */
export async function getMeetsForAthlete(athleteId: string) {
  return prisma.meet.findMany({
    where: { athleteId },
    orderBy: { date: "asc" },
    include: { attempts: { orderBy: [{ lift: "asc" }, { number: "asc" }] } },
  });
}

/** Every phase an athlete has, deep enough to chart the main lifts across all of them. */
export async function getAllPhasesForAthlete(athleteId: string) {
  return prisma.block.findMany({
    where: { athleteId },
    orderBy: { startDate: "asc" },
    include: {
      program: { select: { id: true, name: true } },
      weeks: {
        orderBy: { order: "asc" },
        include: {
          days: {
            orderBy: { index: "asc" },
            include: { rows: { orderBy: { order: "asc" } } },
          },
        },
      },
    },
  });
}

export async function getRoster() {
  const coach = await prisma.coach.findFirst({ where: await myCoach() });
  if (!coach) throw new Error("No coach found — run `npm run db:seed`.");

  const athletes = await prisma.athlete.findMany({
    // The coach's own athletes and those shared with them: everyone here.
    orderBy: { name: "asc" },
    include: {
      team: { select: { name: true } },
      questions: { where: { archived: false }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      programs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          phases: { orderBy: { order: "asc" }, select: { id: true, phase: true, _count: { select: { weeks: true } } } },
        },
      },
    },
  });

  return { coach, athletes };
}

export type RosterAthlete = Awaited<ReturnType<typeof getRoster>>["athletes"][number];

/**
 * The latest days athletes logged in the athlete app, newest first: who, which session,
 * how many sets are ticked off, and when they last touched it.
 */
export async function getRecentCheckins(coachId: string, limit = 8) {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const logs = await prisma.setLog.findMany({
    where: { loggedAt: { gte: since }, row: { day: { week: { block: { athlete: { coachId } } } } } },
    orderBy: { loggedAt: "desc" },
    take: 400,
    select: {
      done: true,
      loggedAt: true,
      row: {
        select: {
          dayId: true,
          day: {
            select: {
              label: true,
              week: {
                select: {
                  order: true,
                  block: { select: { id: true, phase: true, athlete: { select: { id: true, name: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });

  const days = new Map<
    string,
    { dayId: string; athleteId: string; athlete: string; blockId: string; phase: string; week: number; label: string; done: number; last: Date }
  >();
  for (const log of logs) {
    const { day } = log.row;
    const entry = days.get(log.row.dayId) ?? {
      dayId: log.row.dayId,
      athleteId: day.week.block.athlete.id,
      athlete: day.week.block.athlete.name,
      blockId: day.week.block.id,
      phase: day.week.block.phase,
      week: day.week.order,
      label: day.label,
      done: 0,
      last: log.loggedAt,
    };
    if (log.done) entry.done += 1;
    days.set(log.row.dayId, entry);
  }
  return [...days.values()].slice(0, limit);
}

/**
 * Every athlete's training days between two dates (`YYYY-MM-DD`, both included), each with
 * its rows and which sets are ticked. Two reads: the calendar of every phase, then the rows
 * of just the days that fall in the window.
 */
export async function getTrainingWindow(athleteIds: string[], from: string, to: string) {
  const moves = await getMoveMap(athleteIds);
  const blocks = await prisma.block.findMany({
    where: { athleteId: { in: athleteIds } },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      athleteId: true,
      startDate: true,
      weeks: { select: { order: true, days: { select: { id: true, index: true, label: true, rest: true } } } },
    },
  });

  const byAthlete = new Map<string, typeof blocks>();
  for (const b of blocks) byAthlete.set(b.athleteId, [...(byAthlete.get(b.athleteId) ?? []), b]);

  const scheduled = new Map<string, { ymd: string; dayId: string; label: string }[]>();
  for (const [athleteId, list] of byAthlete) {
    scheduled.set(
      athleteId,
      sessionsOf<(typeof list)[number]["weeks"][number]["days"][number], (typeof list)[number]>(list, moves)
        .filter((s) => s.ymd >= from && s.ymd <= to)
        .map((s) => ({ ymd: s.ymd, dayId: s.day.id, label: s.day.label })),
    );
  }

  const dayIds = [...scheduled.values()].flat().map((s) => s.dayId);
  const rows = dayIds.length
    ? await prisma.exerciseRow.findMany({
        where: { dayId: { in: dayIds } },
        select: {
          dayId: true,
          exercise: true,
          sets: true,
          intensityType: true,
          intensity: true,
          intensityMax: true,
          actualWeight: true,
          performedRpe: true,
          logs: { select: { done: true } },
        },
      })
    : [];
  const rowsByDay = new Map<string, typeof rows>();
  for (const r of rows) rowsByDay.set(r.dayId, [...(rowsByDay.get(r.dayId) ?? []), r]);

  const out = new Map<string, WindowSession[]>();
  for (const [athleteId, list] of scheduled) {
    out.set(
      athleteId,
      list.map((s) => ({ ymd: s.ymd, label: s.label, rows: rowsByDay.get(s.dayId) ?? [] })),
    );
  }
  return out;
}

/** Weigh-ins on or after a day, for the athletes given, oldest first; deleted ones left out. */
export async function getBodyweights(athleteIds: string[], from?: string) {
  const rows = await prisma.bodyweightLog.findMany({
    where: { athleteId: { in: athleteIds }, deletedAt: null, ...(from ? { day: { gte: from } } : {}) },
    orderBy: [{ day: "asc" }, { createdAt: "asc" }],
    select: { id: true, athleteId: true, day: true, weight: true, note: true, source: true, createdAt: true },
  });
  const out = new Map<string, ReturnType<typeof bodyweightEntry>[]>();
  for (const r of rows) out.set(r.athleteId, [...(out.get(r.athleteId) ?? []), bodyweightEntry(r)]);
  return out;
}

/** Each athlete's nutrition log on or after a day, oldest first; deleted days left out. */
export async function getNutrition(athleteIds: string[], from?: string): Promise<Map<string, NutritionEntry[]>> {
  const rows = await prisma.nutritionLog.findMany({
    where: { athleteId: { in: athleteIds }, deletedAt: null, ...(from ? { day: { gte: from } } : {}) },
    orderBy: { day: "asc" },
  });
  const out = new Map<string, NutritionEntry[]>();
  for (const r of rows) out.set(r.athleteId, [...(out.get(r.athleteId) ?? []), nutritionEntry(r)]);
  return out;
}

/** The athlete's phases that set nutrition targets, as spans of days. */
export async function getTargetSpans(athleteId: string): Promise<TargetSpan[]> {
  const phases = await prisma.block.findMany({
    where: { athleteId },
    select: { startDate: true, kcalTarget: true, proteinTarget: true, carbsTarget: true, fatTarget: true, _count: { select: { weeks: true } } },
  });
  return phases.map((p) => targetSpan({ ...p, weeks: p._count.weeks })).filter((s): s is TargetSpan => s !== null);
}

/** Each athlete's next meet from a day on, if they have one. */
export async function getNextMeets(athleteIds: string[], from: Date) {
  const meets = await prisma.meet.findMany({
    where: { athleteId: { in: athleteIds }, date: { gte: from } },
    orderBy: { date: "asc" },
    select: { athleteId: true, name: true, date: true, kind: true, opponent: true, weightClass: true, targetWeight: true, weighIn: true },
  });
  const out = new Map<string, (typeof meets)[number]>();
  for (const m of meets) if (!out.has(m.athleteId)) out.set(m.athleteId, m);
  return out;
}

export type CheckinPhotoRef = { id: string; questionId: string; day: string };

export type AthleteCheckins = {
  questions: CheckinQuestionData[];
  answers: CheckinAnswerData[];
  /** Photos on the answers that this computer has a copy of. */
  photos: CheckinPhotoRef[];
};

/**
 * Each athlete's check-in questions — archived ones too, so old answers keep their label —
 * and their answers on or after a day, oldest first.
 */
export async function getCheckins(athleteIds: string[], from?: string): Promise<Map<string, AthleteCheckins>> {
  const [questions, answers, photos] = await Promise.all([
    prisma.checkinQuestion.findMany({ where: { athleteId: { in: athleteIds } }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    prisma.checkinAnswer.findMany({
      where: { athleteId: { in: athleteIds }, deletedAt: null, ...(from ? { day: { gte: from } } : {}) },
      orderBy: { day: "asc" },
      select: { id: true, athleteId: true, questionId: true, day: true, value: true, updatedAt: true },
    }),
    prisma.checkinPhoto.findMany({
      where: { athleteId: { in: athleteIds }, deletedAt: null, uploadedAt: { not: null }, ...(from ? { day: { gte: from } } : {}) },
      orderBy: { createdAt: "asc" },
      select: { id: true, athleteId: true, questionId: true, day: true },
    }),
  ]);
  const out = new Map<string, AthleteCheckins>();
  const entry = (id: string) => {
    let e = out.get(id);
    if (!e) out.set(id, (e = { questions: [], answers: [], photos: [] }));
    return e;
  };
  // The weigh-in and nutrition questions answer into their logs, which have their own panels.
  for (const row of questions) {
    const q = questionData(row);
    if (!isBodyweight(q) && !nutrientOf(q)) entry(row.athleteId).questions.push(q);
  }
  const here = photosHere(photos.map((p) => p.id));
  for (const { athleteId, ...photo } of photos) if (here.has(photo.id)) entry(athleteId).photos.push(photo);
  for (const { athleteId, updatedAt, ...answer } of answers) entry(athleteId).answers.push({ ...answer, updatedAt: updatedAt.toISOString() });
  return out;
}

/** A note from the coach about one session, as Tracking and the athlete's inbox show it. */
export type MessageData = {
  id: string;
  day: string;
  dayId: string | null;
  rowId: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export function messageData(row: {
  id: string;
  day: string;
  dayId: string | null;
  rowId: string | null;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}): MessageData {
  return {
    id: row.id,
    day: row.day,
    dayId: row.dayId,
    rowId: row.rowId,
    body: row.body,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every note the coach sent an athlete that is still standing, oldest first. */
export async function getMessages(athleteId: string): Promise<MessageData[]> {
  const rows = await prisma.coachMessage.findMany({
    where: { athleteId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(messageData);
}

/**
 * Sessions with something new since the coach last reviewed them, per athlete, over the
 * last `days` days: logged sets after `reviewedAt`, or never reviewed at all.
 */
export async function getUnreviewed(coachId: string, days = 14): Promise<Map<string, { count: number; blockId: string; week: number }>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const logs = await prisma.setLog.findMany({
    where: { done: true, loggedAt: { gte: since }, row: { day: { week: { block: { athlete: { coachId } } } } } },
    select: {
      loggedAt: true,
      row: {
        select: {
          day: {
            select: {
              id: true,
              reviewedAt: true,
              week: { select: { order: true, block: { select: { id: true, athleteId: true } } } },
            },
          },
        },
      },
    },
  });
  const sessions = new Map<string, { athleteId: string; blockId: string; week: number; last: Date; reviewedAt: Date | null }>();
  for (const log of logs) {
    const day = log.row.day;
    const had = sessions.get(day.id);
    if (had && had.last >= log.loggedAt) continue;
    sessions.set(day.id, { athleteId: day.week.block.athleteId, blockId: day.week.block.id, week: day.week.order, last: log.loggedAt, reviewedAt: day.reviewedAt });
  }
  const out = new Map<string, { count: number; blockId: string; week: number }>();
  for (const d of sessions.values()) {
    if (d.reviewedAt && d.reviewedAt >= d.last) continue;
    const had = out.get(d.athleteId);
    // The link opens the oldest session still waiting.
    if (!had) out.set(d.athleteId, { count: 1, blockId: d.blockId, week: d.week });
    else had.count++;
  }
  return out;
}

export type RecentPr = {
  id: string;
  athleteId: string;
  athlete: string;
  exercise: string;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  blockId: string;
  week: number;
  loggedAt: Date;
};

/** Sets the athletes flagged as PRs in the last `days` days, newest first. */
export async function getRecentPrs(coachId: string, days = 14): Promise<RecentPr[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const logs = await prisma.setLog.findMany({
    where: { pr: true, loggedAt: { gte: since }, row: { day: { week: { block: { athlete: { coachId } } } } } },
    orderBy: { loggedAt: "desc" },
    take: 50,
    select: {
      id: true,
      weight: true,
      reps: true,
      rpe: true,
      rir: true,
      loggedAt: true,
      row: {
        select: {
          exercise: true,
          day: { select: { week: { select: { order: true, block: { select: { id: true, athlete: { select: { id: true, name: true } } } } } } } },
        },
      },
    },
  });
  return logs.map((l) => ({
    id: l.id,
    athleteId: l.row.day.week.block.athlete.id,
    athlete: l.row.day.week.block.athlete.name,
    exercise: l.row.exercise,
    weight: l.weight,
    reps: l.reps,
    rpe: l.rpe,
    rir: l.rir,
    blockId: l.row.day.week.block.id,
    week: l.row.day.week.order,
    loggedAt: l.loggedAt,
  }));
}

/** Whether the athlete has any timed row at all: Tracking only offers Load when so. */
export async function hasTimedRows(athleteId: string): Promise<boolean> {
  const row = await prisma.exerciseRow.findFirst({
    where: { duration: { not: null }, exercise: { not: "" }, day: { rest: false, week: { block: { athleteId } } } },
    select: { id: true },
  });
  return row !== null;
}

/** Every timed row the athlete has on a training day, dated, with its logged rounds — for Load. */
export async function getTimedRows(athleteId: string): Promise<TimedRow[]> {
  const rows = await prisma.exerciseRow.findMany({
    where: { duration: { not: null }, exercise: { not: "" }, day: { rest: false, week: { block: { athleteId } } } },
    select: {
      sets: true,
      duration: true,
      intensityType: true,
      intensity: true,
      logs: { select: { seconds: true, rpe: true, rir: true, done: true } },
      day: { select: { index: true, week: { select: { order: true, block: { select: { startDate: true } } } } } },
    },
  });
  return rows.map(({ day, duration, ...row }) => ({
    ...row,
    duration: duration!,
    ymd: dateOfDay(day.week.block.startDate, day.week.order, day.index),
  }));
}

/** The athlete's injuries on file, current and past. */
export async function injuriesFor(athleteId: string): Promise<InjuryData[]> {
  const rows = await prisma.injury.findMany({ where: { athleteId, deletedAt: null }, orderBy: { day: "desc" } });
  return rows.map(injuryData);
}

/** The injuries each of these athletes has on a day, worst first. */
export async function getActiveInjuries(athleteIds: string[], today: string): Promise<Map<string, InjuryData[]>> {
  const rows = await prisma.injury.findMany({
    where: { athleteId: { in: athleteIds }, deletedAt: null, day: { lte: today }, OR: [{ endDay: null }, { endDay: { gt: today } }] },
    orderBy: [{ severity: "desc" }, { day: "desc" }],
  });
  const out = new Map<string, InjuryData[]>();
  for (const r of rows) out.set(r.athleteId, [...(out.get(r.athleteId) ?? []), injuryData(r)]);
  return out;
}

/** A session the athlete moved, as Tracking lists it: with its name and where it sits in the plan. */
export type MoveView = MoveData & { label: string | null; phase: string | null; week: number | null };

/** The athlete's moved sessions still standing, newest move first. */
export async function getMoves(athleteId: string): Promise<MoveView[]> {
  const rows = await prisma.sessionMove.findMany({ where: { athleteId, deletedAt: null }, orderBy: { updatedAt: "desc" } });
  const days = rows.length
    ? await prisma.day.findMany({
        where: { id: { in: rows.map((r) => r.dayId) } },
        select: { id: true, label: true, week: { select: { order: true, block: { select: { phase: true } } } } },
      })
    : [];
  const byId = new Map(days.map((d) => [d.id, d]));
  return rows.map((r) => {
    const d = byId.get(r.dayId);
    return { ...moveData(r), label: d?.label ?? null, phase: d?.week.block.phase ?? null, week: d?.week.order ?? null };
  });
}

/** Session → the date the athlete moved it to, for laying out the coach's calendar. */
export async function getMoveMap(athleteIds: string[]): Promise<Map<string, string>> {
  const rows = await prisma.sessionMove.findMany({
    where: { athleteId: { in: athleteIds }, deletedAt: null },
    select: { dayId: true, day: true },
  });
  return movesMap(rows);
}

/** Every meeting with the athlete that is still standing, soonest first. */
export async function getMeetings(athleteId: string): Promise<MeetingData[]> {
  const rows = await prisma.meeting.findMany({ where: { athleteId, deletedAt: null } });
  return rows.map(meetingData).sort(byWhen);
}

/** What the Schedule tab has for the coach: moves not yet seen, and meetings still to answer. */
export async function scheduleNews(athleteId: string, today: string): Promise<number> {
  const [moves, meetings] = await Promise.all([
    prisma.sessionMove.count({ where: { athleteId, deletedAt: null, seenAt: null } }),
    prisma.meeting.count({ where: { athleteId, deletedAt: null, status: "PROPOSED", proposedBy: "athlete", day: { gte: today } } }),
  ]);
  return moves + meetings;
}
