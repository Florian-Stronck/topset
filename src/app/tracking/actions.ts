"use server";

import { revalidatePath } from "next/cache";
import { bodyweightEntry, type BodyweightEntry } from "@/lib/bodyweight";
import { prisma } from "@/lib/prisma";
import { assertCoach } from "@/lib/role";

/**
 * The coach's side of bodyweight: a weigh-in typed in on the desktop (at a meet, say), or
 * one taken back. Deletes are tombstones, so sync carries them to the athlete's phone.
 */

function refresh() {
  revalidatePath("/tracking");
  revalidatePath("/overview");
}

export async function addBodyweight(athleteId: string, day: string, weight: number): Promise<BodyweightEntry> {
  assertCoach();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error("That day isn't a date.");
  if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) throw new Error("That weight doesn't look right.");
  const row = await prisma.bodyweightLog.create({
    data: { athleteId, day, weight: Number(weight.toFixed(2)), source: "coach" },
  });
  refresh();
  return bodyweightEntry(row);
}

export async function deleteBodyweight(id: string) {
  assertCoach();
  await prisma.bodyweightLog.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  refresh();
}
