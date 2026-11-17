"use server";

import { revalidatePath } from "next/cache";
import * as meets from "@/lib/competition-writes";
import { myCoach } from "@/lib/me";
import { prisma } from "@/lib/prisma";
import { assertCoach } from "@/lib/role";

/** The desktop app's actions on whole competitions (the phone has none); the writes are in `competition-writes.ts`. */

function revalidateAll() {
  revalidatePath("/competition");
  revalidatePath("/overview");
  revalidatePath("/programming");
}

type Args<F extends (...args: never[]) => unknown> = Parameters<F>;

export async function createCompetition(input: Omit<Args<typeof meets.createCompetition>[0], "coachId">) {
  assertCoach();
  const coach = await prisma.coach.findFirstOrThrow({ where: await myCoach(), select: { id: true } });
  const id = await meets.createCompetition({ ...input, coachId: coach.id });
  revalidateAll();
  return id;
}

export async function updateCompetition(...args: Args<typeof meets.updateCompetition>) {
  assertCoach();
  await meets.updateCompetition(...args);
  revalidateAll();
}

export async function deleteCompetition(...args: Args<typeof meets.deleteCompetition>) {
  assertCoach();
  await meets.deleteCompetition(...args);
  revalidateAll();
}

export async function addEntries(...args: Args<typeof meets.addEntries>) {
  assertCoach();
  const ids = await meets.addEntries(...args);
  revalidateAll();
  return ids;
}
