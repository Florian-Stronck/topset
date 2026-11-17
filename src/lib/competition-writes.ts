import type { AttemptResult, MeetLift } from "@prisma/client";
import {
  ATTEMPT_ROWS,
  best,
  MEET_LIFTS,
  maxFor,
  NO_RACK,
  parseRacks,
  planned,
  rackBrand,
  suggestion,
  thirdFor,
  USUAL_TASKS,
  type Rack,
  type TaskOwner,
  type ThirdPlan,
} from "@/lib/competition";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";
import { parseReminders, serializeReminders, type ReminderKind, type ReminderText } from "@/lib/meet-reminders";
import { prisma } from "@/lib/prisma";

/**
 * Writing meets: the desktop app's Competition actions and the coach's phone both run these.
 * Who may is the caller's to check.
 */

/**
 * The fields a competition and every entry in it share. Each `Meet` keeps a copy, so they are
 * written only through `applyShared`, which writes the competition and all its entries together.
 */
export const SHARED_FIELDS = ["name", "date", "federation", "venue", "weighInDay", "weighInTime", "startTime", "rackBrand"] as const;

type SharedPatch = {
  name?: string;
  date?: string;
  federation?: string | null;
  venue?: string | null;
  weighInDay?: string | null;
  weighInTime?: string | null;
  startTime?: string | null;
  rackBrand?: string | null;
  reminders?: string | null;
};

/** A touched entry: what the phone logs and whose counter it moves. */
export type Entry = { id: string; athleteId: string };

/**
 * Writes shared fields onto the competition and each of its entries, or, with `only`, onto those
 * entries alone (a coach editing a shared athlete's meet in someone else's competition).
 * The competition may not be here at all (a shared athlete's, on another coach's desktop): updateMany.
 */
async function applyShared(competitionId: string, patch: SharedPatch, only?: string[]): Promise<Entry[]> {
  const { date, rackBrand: brand, ...rest } = patch;
  const entries = await prisma.meet.findMany({
    where: { competitionId, ...(only ? { id: { in: only } } : {}) },
    select: { id: true, athleteId: true, athlete: { select: { racks: true } } },
  });
  const ids = entries.map((e) => e.id);
  const data = { ...rest, ...(date ? { date: new Date(date) } : {}) };
  if (!only) {
    await prisma.competition.updateMany({
      where: { id: competitionId },
      data: { ...data, ...(brand !== undefined ? { rackBrand: brand?.trim() || null } : {}) },
    });
  }
  if (Object.keys(data).length) await prisma.meet.updateMany({ where: { id: { in: ids } }, data });
  // Spelled the way each athlete's profile already has it, so "eleiko" finds their Eleiko heights.
  if (brand !== undefined) {
    for (const e of entries) await prisma.meet.update({ where: { id: e.id }, data: { rackBrand: rackBrand(parseRacks(e.athlete.racks), brand) } });
  }
  // The checklist is dated by the meet, as every row the athlete app merges is.
  if (date) await prisma.meetTask.updateMany({ where: { meetId: { in: ids } }, data: { day: date.slice(0, 10) } });
  return entries.map((e) => ({ id: e.id, athleteId: e.athleteId }));
}

/**
 * A meet is created with its nine empty attempts, so the card is never half-built. Without a
 * competition it starts one of its own; with one it takes that competition's shared fields.
 */
export async function createMeet(input: {
  coachId: string;
  athleteId: string;
  name: string;
  date: string;
  federation?: string;
  weightClass?: string;
  competitionId?: string;
  shared?: boolean;
}) {
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: input.athleteId }, select: { racks: true } });
  let competition;
  if (input.competitionId) {
    competition = await prisma.competition.findUniqueOrThrow({ where: { id: input.competitionId } });
  } else {
    // Most meets in a federation lift on the same racks: start from the last brand named.
    const last = await prisma.meet.findFirst({
      where: { athleteId: input.athleteId, rackBrand: { not: null } },
      orderBy: { date: "desc" },
      select: { rackBrand: true },
    });
    competition = await prisma.competition.create({
      data: {
        coachId: input.coachId,
        name: input.name.trim() || "Meet",
        date: new Date(input.date),
        federation: input.federation?.trim() || null,
        rackBrand: last?.rackBrand ?? null,
      },
    });
  }
  const meet = await prisma.meet.create({
    data: {
      athleteId: input.athleteId,
      competitionId: competition.id,
      name: competition.name,
      date: competition.date,
      federation: competition.federation,
      venue: competition.venue,
      weighInDay: competition.weighInDay,
      weighInTime: competition.weighInTime,
      startTime: competition.startTime,
      rackBrand: rackBrand(parseRacks(athlete.racks), competition.rackBrand),
      reminders: competition.reminders,
      shared: input.shared ?? competition.shared,
      weightClass: input.weightClass?.trim() || null,
      attempts: {
        create: MEET_LIFTS.flatMap((lift) =>
          [1, 2, 3].map((number) => ({ lift, number })),
        ),
      },
    },
  });

  return meet.id;
}

/**
 * One athlete's entry: their own fields on it alone, the shared ones on the whole competition
 * (or, with `entryOnly`, on this entry alone). Returns the entries touched.
 */
export async function updateMeet(
  meetId: string,
  patch: Omit<SharedPatch, "reminders"> & {
    weightClass?: string | null;
    bodyweight?: number | null;
    goal?: number | null;
    session?: string | null;
    shared?: boolean;
    shareAttempts?: boolean;
  },
  entryOnly = false,
): Promise<Entry[]> {
  const own: Record<string, unknown> = { ...patch };
  const shared: Record<string, unknown> = {};
  for (const k of SHARED_FIELDS) {
    if (k in own) {
      shared[k] = own[k];
      delete own[k];
    }
  }
  const meet = await prisma.meet.update({ where: { id: meetId }, data: own, select: { athleteId: true, competitionId: true } });
  if (Object.keys(shared).length === 0) return [{ id: meetId, athleteId: meet.athleteId }];
  return applyShared(meet.competitionId, shared as SharedPatch, entryOnly ? [meetId] : undefined);
}

/**
 * The athlete's settings on a brand of rack, kept on their profile: every meet on that brand
 * reads them, this one and the next. A brand with nothing set is dropped.
 */
export async function setRack(athleteId: string, brand: string, patch: Partial<Rack>) {
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: athleteId }, select: { racks: true } });
  const racks = parseRacks(athlete.racks);
  const name = rackBrand(racks, brand);
  if (!name) return;
  const clean = (v: string | null | undefined) => (v?.trim() ? v.trim().slice(0, 20) : null);
  const was = racks[name] ?? NO_RACK;
  const next = {
    squat: patch.squat !== undefined ? clean(patch.squat) : was.squat,
    bench: patch.bench !== undefined ? clean(patch.bench) : was.bench,
    safety: patch.safety !== undefined ? clean(patch.safety) : was.safety,
  };
  if (next.squat || next.bench || next.safety) racks[name] = next;
  else delete racks[name];
  await prisma.athlete.update({ where: { id: athleteId }, data: { racks: Object.keys(racks).length ? JSON.stringify(racks) : null } });
}

/** One reminder switched on or off, or reworded; null text puts back the words it starts with. */
export async function setReminder(
  meetId: string,
  kind: ReminderKind,
  patch: { on?: boolean; text?: ReminderText | null },
  entryOnly = false,
): Promise<Entry[]> {
  const meet = await prisma.meet.findUniqueOrThrow({ where: { id: meetId }, select: { reminders: true, competitionId: true } });
  const settings = parseReminders(meet.reminders);
  if (patch.on !== undefined) settings.on[kind] = patch.on;
  if (patch.text === null) delete settings.text[kind];
  else if (patch.text) settings.text[kind] = { title: patch.text.title.trim().slice(0, 120), body: patch.text.body.trim().slice(0, 300) };
  return applyShared(meet.competitionId, { reminders: serializeReminders(settings) }, entryOnly ? [meetId] : undefined);
}

/** A competition with nobody entered yet. */
export async function createCompetition(input: { coachId: string; name: string; date: string; federation?: string }) {
  const competition = await prisma.competition.create({
    data: {
      coachId: input.coachId,
      name: input.name.trim() || "Meet",
      date: new Date(input.date),
      federation: input.federation?.trim() || null,
    },
  });
  return competition.id;
}

/** The shared fields, on the competition and every entry; `shared` is only the default for new entries. */
export async function updateCompetition(id: string, patch: Omit<SharedPatch, "reminders"> & { shared?: boolean }) {
  const { shared, ...rest } = patch;
  if (shared !== undefined) await prisma.competition.updateMany({ where: { id }, data: { shared } });
  return applyShared(id, rest);
}

/** The competition and every entry in it. */
export async function deleteCompetition(id: string) {
  // The checklists hang off the meets by id alone; tombstones carry the delete to the phones.
  const meets = await prisma.meet.findMany({ where: { competitionId: id }, select: { id: true } });
  await prisma.meetTask.updateMany({ where: { meetId: { in: meets.map((m) => m.id) }, deletedAt: null }, data: { deletedAt: new Date() } });
  await prisma.competition.delete({ where: { id } });
}

/** Enters athletes, each with their class; anyone already entered is left as they are. Returns the new meets' ids. */
export async function addEntries(competitionId: string, athletes: { athleteId: string; weightClass: string | null }[], shared: boolean) {
  const competition = await prisma.competition.findUniqueOrThrow({ where: { id: competitionId } });
  const entered = new Set((await prisma.meet.findMany({ where: { competitionId }, select: { athleteId: true } })).map((m) => m.athleteId));
  const ids: string[] = [];
  for (const a of athletes) {
    if (entered.has(a.athleteId)) continue;
    entered.add(a.athleteId);
    ids.push(
      await createMeet({
        coachId: competition.coachId,
        athleteId: a.athleteId,
        name: competition.name,
        date: competition.date.toISOString(),
        weightClass: a.weightClass ?? undefined,
        competitionId,
        shared,
      }),
    );
  }
  return ids;
}

async function taskOrder(meetId: string) {
  const last = await prisma.meetTask.findFirst({ where: { meetId }, orderBy: { order: "desc" }, select: { order: true } });
  return (last?.order ?? -1) + 1;
}

/** Adds things to sort before the meet, the athlete's or the coach's own. */
export async function addTasks(meetId: string, tasks: { text: string; owner: TaskOwner }[]) {
  const meet = await prisma.meet.findUniqueOrThrow({ where: { id: meetId }, select: { athleteId: true, date: true } });
  const from = await taskOrder(meetId);
  const rows = tasks
    .map((x) => ({ text: x.text.trim().slice(0, 200), owner: x.owner === "athlete" ? "athlete" : "coach" }))
    .filter((x) => x.text !== "");
  await prisma.meetTask.createMany({
    data: rows.map((x, i) => ({ ...x, meetId, athleteId: meet.athleteId, day: meet.date.toISOString().slice(0, 10), order: from + i })),
  });
}

/** The usual list, in the coach's language: what most meets need sorted, and whose each is. */
export async function addUsualTasks(meetId: string) {
  await loadSettings();
  await addTasks(meetId, USUAL_TASKS.map((x) => ({ text: t(x.text), owner: x.owner })));
}

export async function tickTask(id: string, done: boolean) {
  await prisma.meetTask.update({ where: { id }, data: { done, doneBy: done ? "coach" : null } });
}

/** Kept as a tombstone, so the athlete's copy drops it too. */
export async function removeTask(id: string) {
  await prisma.meetTask.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** Every third not yet called, one jump under the plan off the 1RMs, on it, or one over. */
export async function setThirds(meetId: string, plan: ThirdPlan) {
  await loadSettings();
  const meet = await prisma.meet.findUniqueOrThrow({
    where: { id: meetId },
    include: { athlete: true, attempts: true },
  });
  const writes = MEET_LIFTS.flatMap((lift) => {
    const weight = thirdFor(plan, maxFor(lift, meet.athlete), meet.athlete.unit);
    const third = meet.attempts.find((a) => a.lift === lift && a.number === 3);
    if (weight === null || third?.result === "GOOD" || third?.result === "MISS") return [];
    return [
      prisma.attempt.upsert({
        where: { meetId_lift_number: { meetId, lift, number: 3 } },
        create: { meetId, lift, number: 3, weight },
        update: { weight },
      }),
    ];
  });
  if (writes.length > 0) await prisma.$transaction(writes);
}

export async function deleteMeet(meetId: string) {
  // Its checklist hangs off it by id alone; tombstones carry the delete to the phone.
  await prisma.meetTask.updateMany({ where: { meetId, deletedAt: null }, data: { deletedAt: new Date() } });
  await prisma.meet.delete({ where: { id: meetId } });
}

export async function updateAttempt(
  meetId: string,
  lift: MeetLift,
  number: number,
  patch: { weight?: number | null; result?: AttemptResult },
) {
  await prisma.attempt.upsert({
    where: { meetId_lift_number: { meetId, lift, number } },
    create: { meetId, lift, number, ...patch },
    update: patch,
  });
  if (patch.result && patch.result !== "PENDING" && number < 3) await fillNext(meetId, lift, number + 1);
}

/**
 * Once an attempt is called, the next one on that lift gets its weight if it has none yet:
 * a jump after a make, the same again after a miss. On the day that is one click less.
 */
async function fillNext(meetId: string, lift: MeetLift, number: number) {
  await loadSettings();
  const meet = await prisma.meet.findUniqueOrThrow({
    where: { id: meetId },
    include: { athlete: true, attempts: true },
  });
  const next = meet.attempts.find((a) => a.lift === lift && a.number === number);
  if (!next || next.weight !== null) return;
  const weight = suggestion(meet.attempts, lift, number, maxFor(lift, meet.athlete), meet.athlete.unit);
  if (weight !== null) await prisma.attempt.update({ where: { id: next.id }, data: { weight } });
}

/**
 * Fills every attempt that is still blank from the athlete's 1RMs. Attempts already
 * written down are left alone — the plan is a starting point, not a reset.
 */
export async function planFromMaxes(meetId: string) {
  await loadSettings();
  const meet = await prisma.meet.findUniqueOrThrow({
    where: { id: meetId },
    include: { athlete: true, attempts: true },
  });

  // All nine, not just the rows there: a meet brought in from elsewhere may have none yet.
  const writes = ATTEMPT_ROWS.flatMap(({ lift, number }) => {
    if ((meet.attempts.find((a) => a.lift === lift && a.number === number)?.weight ?? null) !== null) return [];
    const weight = planned(maxFor(lift, meet.athlete), number, meet.athlete.unit);
    if (weight === null) return [];
    return [
      prisma.attempt.upsert({
        where: { meetId_lift_number: { meetId, lift, number } },
        create: { meetId, lift, number, weight },
        update: { weight },
      }),
    ];
  });

  if (writes.length > 0) await prisma.$transaction(writes);
}

/**
 * Writes the meet's best successful lifts onto the athlete's 1RMs. A competition single
 * is the realest max there is, and every target weight in the next block comes off it.
 */
export async function applyResultsAsMaxes(meetId: string) {
  const meet = await prisma.meet.findUniqueOrThrow({
    where: { id: meetId },
    include: { attempts: true },
  });

  const squat1RM = best(meet.attempts, "SQUAT");
  const bench1RM = best(meet.attempts, "BENCH");
  const dead1RM = best(meet.attempts, "DEADLIFT");

  await prisma.athlete.update({
    where: { id: meet.athleteId },
    data: {
      ...(squat1RM !== null ? { squat1RM } : {}),
      ...(bench1RM !== null ? { bench1RM } : {}),
      ...(dead1RM !== null ? { dead1RM } : {}),
    },
  });

}
