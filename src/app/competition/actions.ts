"use server";

import { assertCoach } from "@/lib/role";
import { revalidatePath } from "next/cache";
import * as meets from "@/lib/competition-writes";

/** The desktop app's Competition actions; the writes themselves are in `competition-writes.ts`. */

function revalidateAll() {
  revalidatePath("/competition");
  revalidatePath("/overview");
  revalidatePath("/programming");
}

type Args<F extends (...args: never[]) => unknown> = Parameters<F>;

export async function createMeet(...args: Args<typeof meets.createMeet>) {
  assertCoach();
  const id = await meets.createMeet(...args);
  revalidateAll();
  return id;
}

export async function updateMeet(...args: Args<typeof meets.updateMeet>) {
  assertCoach();
  await meets.updateMeet(...args);
  revalidateAll();
}

export async function setRack(...args: Args<typeof meets.setRack>) {
  assertCoach();
  await meets.setRack(...args);
  revalidateAll();
  revalidatePath("/athletes");
}

export async function setReminder(...args: Args<typeof meets.setReminder>) {
  assertCoach();
  await meets.setReminder(...args);
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
