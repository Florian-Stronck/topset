"use server";

import { assertCoach } from "@/lib/role";
import { revalidatePath } from "next/cache";
import type { AttemptResult, MeetLift } from "@prisma/client";
import { best, MEET_LIFTS, maxFor, planned } from "@/lib/competition";
import { prisma } from "@/lib/prisma";

function revalidateAll() {
  revalidatePath("/competition");
  revalidatePath("/overview");
  revalidatePath("/programming");
}

/** A meet is created with its nine empty attempts, so the card is never half-built. */
export async function createMeet(input: {
  athleteId: string;
  name: string;
  date: string;
  federation?: string;
  weightClass?: string;
}) {
  assertCoach();
  const meet = await prisma.meet.create({
    data: {
      athleteId: input.athleteId,
      name: input.name.trim() || "Meet",
      date: new Date(input.date),
      federation: input.federation?.trim() || null,
      weightClass: input.weightClass?.trim() || null,
      attempts: {
        create: MEET_LIFTS.flatMap((lift) =>
          [1, 2, 3].map((number) => ({ lift, number })),
        ),
      },
    },
  });

  revalidateAll();
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
  },
) {
  assertCoach();
  const { date, ...rest } = patch;
  await prisma.meet.update({
    where: { id: meetId },
    data: { ...rest, ...(date ? { date: new Date(date) } : {}) },
  });
  revalidateAll();
}

export async function deleteMeet(meetId: string) {
  assertCoach();
  await prisma.meet.delete({ where: { id: meetId } });
  revalidateAll();
}

export async function updateAttempt(
  meetId: string,
  lift: MeetLift,
  number: number,
  patch: { weight?: number | null; result?: AttemptResult },
) {
  assertCoach();
  await prisma.attempt.upsert({
    where: { meetId_lift_number: { meetId, lift, number } },
    create: { meetId, lift, number, ...patch },
    update: patch,
  });
  revalidateAll();
}

/**
 * Fills every attempt that is still blank from the athlete's 1RMs. Attempts already
 * written down are left alone — the plan is a starting point, not a reset.
 */
export async function planFromMaxes(meetId: string) {
  assertCoach();
  const meet = await prisma.meet.findUniqueOrThrow({
    where: { id: meetId },
    include: { athlete: true, attempts: true },
  });

  const writes = meet.attempts
    .filter((attempt) => attempt.weight === null)
    .map((attempt) => {
      const weight = planned(maxFor(attempt.lift, meet.athlete), attempt.number, meet.athlete.unit);
      return weight === null
        ? null
        : prisma.attempt.update({ where: { id: attempt.id }, data: { weight } });
    })
    .filter((write) => write !== null);

  if (writes.length > 0) await prisma.$transaction(writes);
  revalidateAll();
}

/**
 * Writes the meet's best successful lifts onto the athlete's 1RMs. A competition single
 * is the realest max there is, and every target weight in the next block comes off it.
 */
export async function applyResultsAsMaxes(meetId: string) {
  assertCoach();
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

  revalidateAll();
  revalidatePath("/athletes");
}
