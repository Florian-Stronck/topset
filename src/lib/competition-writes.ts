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

/** A meet is created with its nine empty attempts, so the card is never half-built. */
export async function createMeet(input: {
  athleteId: string;
  name: string;
  date: string;
  federation?: string;
  weightClass?: string;
}) {
  // Most meets in a federation lift on the same racks: start from the last brand named.
  const last = await prisma.meet.findFirst({
    where: { athleteId: input.athleteId, rackBrand: { not: null } },
    orderBy: { date: "desc" },
    select: { rackBrand: true },
  });
  const meet = await prisma.meet.create({
    data: {
      athleteId: input.athleteId,
      name: input.name.trim() || "Meet",
      date: new Date(input.date),
      federation: input.federation?.trim() || null,
      weightClass: input.weightClass?.trim() || null,
      rackBrand: last?.rackBrand ?? null,
      attempts: {
        create: MEET_LIFTS.flatMap((lift) =>
          [1, 2, 3].map((number) => ({ lift, number })),
        ),
      },
    },
  });

  return meet.id;
}

export async function updateMeet(
  meetId: string,
  patch: {
    name?: string;
    date?: string;
    federation?: string | null;
    weightClass?: string | null;
    bodyweight?: number | null;
    goal?: number | null;
    venue?: string | null;
    weighInDay?: string | null;
    weighInTime?: string | null;
    startTime?: string | null;
    session?: string | null;
    rackBrand?: string | null;
    shared?: boolean;
    shareAttempts?: boolean;
  },
) {
  const { date, rackBrand: brand, ...rest } = patch;
  const meet = await prisma.meet.update({
    where: { id: meetId },
    data: {
      ...rest,
      ...(date ? { date: new Date(date) } : {}),
    },
    select: { athleteId: true },
  });
  // Spelled the way the athlete's profile already has it, so "eleiko" finds their Eleiko heights.
  if (brand !== undefined) {
    const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: meet.athleteId }, select: { racks: true } });
    await prisma.meet.update({ where: { id: meetId }, data: { rackBrand: rackBrand(parseRacks(athlete.racks), brand) } });
  }
  // The checklist is dated by the meet, as every row the athlete app merges is.
  if (date) await prisma.meetTask.updateMany({ where: { meetId }, data: { day: date.slice(0, 10) } });
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
export async function setReminder(meetId: string, kind: ReminderKind, patch: { on?: boolean; text?: ReminderText | null }) {
  const meet = await prisma.meet.findUniqueOrThrow({ where: { id: meetId }, select: { reminders: true } });
  const settings = parseReminders(meet.reminders);
  if (patch.on !== undefined) settings.on[kind] = patch.on;
  if (patch.text === null) delete settings.text[kind];
  else if (patch.text) settings.text[kind] = { title: patch.text.title.trim().slice(0, 120), body: patch.text.body.trim().slice(0, 300) };
  await prisma.meet.update({ where: { id: meetId }, data: { reminders: serializeReminders(settings) } });
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
