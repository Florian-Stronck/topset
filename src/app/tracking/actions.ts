"use server";

import { revalidatePath } from "next/cache";
import { bodyweightEntry, type BodyweightEntry } from "@/lib/bodyweight";
import { prisma } from "@/lib/prisma";
import { messageData, type MessageData } from "@/lib/queries";
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

/*
 * Session review: marking a session looked at, and notes for the athlete about it. A note
 * lands in the athlete app's inbox; like weigh-ins it syncs row by row, deletes as tombstones.
 */

const MAX_MESSAGE = 4000;

function cleanBody(body: string): string {
  const text = body.trim();
  if (text === "") throw new Error("Write something first.");
  if (text.length > MAX_MESSAGE) throw new Error("That's too long for one note.");
  return text;
}

/** Marks sessions reviewed now, or takes the mark off again. */
export async function markReviewed(dayIds: string[], reviewed: boolean): Promise<string | null> {
  assertCoach();
  const at = reviewed ? new Date() : null;
  await prisma.day.updateMany({ where: { id: { in: dayIds } }, data: { reviewedAt: at } });
  refresh();
  return at?.toISOString() ?? null;
}

/** A note to the athlete about one session; sending it marks the session reviewed. */
export async function sendMessage(
  athleteId: string,
  dayId: string,
  day: string,
  body: string,
  rowId: string | null = null,
): Promise<{ message: MessageData; reviewedAt: string }> {
  assertCoach();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("That day isn't a date.");
  const text = cleanBody(body);
  const now = new Date();
  const [row] = await prisma.$transaction([
    prisma.coachMessage.create({ data: { athleteId, day, dayId, rowId, body: text } }),
    prisma.day.update({ where: { id: dayId }, data: { reviewedAt: now } }),
  ]);
  refresh();
  return { message: messageData(row), reviewedAt: now.toISOString() };
}

/** Rewording a note shows it as new in the athlete's inbox again. */
export async function editMessage(id: string, body: string): Promise<MessageData> {
  assertCoach();
  const row = await prisma.coachMessage.update({ where: { id }, data: { body: cleanBody(body), readAt: null } });
  refresh();
  return messageData(row);
}

export async function deleteMessage(id: string) {
  assertCoach();
  await prisma.coachMessage.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  refresh();
}
