"use server";

import { assertCoach } from "@/lib/role";
import { revalidatePath } from "next/cache";
import * as meets from "@/lib/competition-writes";
import { myCoach } from "@/lib/me";
import { prisma } from "@/lib/prisma";

/** The desktop app's Competition actions; the writes themselves are in `competition-writes.ts`. */

function revalidateAll() {
  revalidatePath("/competition");
  revalidatePath("/overview");
  revalidatePath("/programming");
}

type Args<F extends (...args: never[]) => unknown> = Parameters<F>;

export async function createMeet(input: Omit<Args<typeof meets.createMeet>[0], "coachId">) {
  assertCoach();
  const coach = await prisma.coach.findFirstOrThrow({ where: await myCoach(), select: { id: true } });
  const id = await meets.createMeet({ ...input, coachId: coach.id });
  revalidateAll();
  return id;
}

export async function updateMeet(meetId: string, patch: Args<typeof meets.updateMeet>[1]) {
  assertCoach();
  await meets.updateMeet(meetId, patch);
  revalidateAll();
}

export async function setRack(...args: Args<typeof meets.setRack>) {
  assertCoach();
  await meets.setRack(...args);
  revalidateAll();
  revalidatePath("/athletes");
}

export async function setReminder(meetId: string, kind: Args<typeof meets.setReminder>[1], patch: Args<typeof meets.setReminder>[2]) {
  assertCoach();
  await meets.setReminder(meetId, kind, patch);
  revalidateAll();
}

export async function addTasks(...args: Args<typeof meets.addTasks>) {
  assertCoach();
  await meets.addTasks(...args);
  revalidateAll();
}

export async function addUsualTasks(...args: Args<typeof meets.addUsualTasks>) {
  assertCoach();
  await meets.addUsualTasks(...args);
  revalidateAll();
}

export async function tickTask(...args: Args<typeof meets.tickTask>) {
  assertCoach();
  await meets.tickTask(...args);
  revalidateAll();
}

export async function removeTask(...args: Args<typeof meets.removeTask>) {
  assertCoach();
  await meets.removeTask(...args);
  revalidateAll();
}

export async function setThirds(...args: Args<typeof meets.setThirds>) {
  assertCoach();
  await meets.setThirds(...args);
  revalidateAll();
}

export async function deleteMeet(...args: Args<typeof meets.deleteMeet>) {
  assertCoach();
  await meets.deleteMeet(...args);
  revalidateAll();
}

export async function updateAttempt(...args: Args<typeof meets.updateAttempt>) {
  assertCoach();
  await meets.updateAttempt(...args);
  revalidateAll();
}

export async function planFromMaxes(...args: Args<typeof meets.planFromMaxes>) {
  assertCoach();
  await meets.planFromMaxes(...args);
  revalidateAll();
}

export async function applyResultsAsMaxes(...args: Args<typeof meets.applyResultsAsMaxes>) {
  assertCoach();
  await meets.applyResultsAsMaxes(...args);
  revalidateAll();
  revalidatePath("/athletes");
}
