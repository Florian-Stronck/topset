"use server";

import { revalidatePath } from "next/cache";
import { bodyweightEntry, type BodyweightEntry } from "@/lib/bodyweight";
import { NUTRIENTS, type Nutrient } from "@/lib/checkins";
import { cleanInjury, injuryData, type InjuryData, type InjuryInput } from "@/lib/injuries";
import { cleanAmount, isEmpty, nutritionEntry, nutritionId, type NutritionEntry } from "@/lib/nutrition";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { cleanMeeting, meetingData, waitingOn, type MeetingData, type MeetingInput } from "@/lib/meetings";
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

/**
 * The coach's side of nutrition: a day's totals typed in or corrected on the desktop. It
 * writes the same row the athlete's check-in does, so the newer of the two wins on sync.
 * Clearing every number deletes the day, as a tombstone.
 */
export async function saveNutrition(athleteId: string, day: string, values: Partial<Record<Nutrient, unknown>>): Promise<NutritionEntry | null> {
  assertCoach();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error("That day isn't a date.");
  const data = Object.fromEntries(NUTRIENTS.map((n) => [n, cleanAmount(n, values[n])])) as Record<Nutrient, number | null>;
  const id = nutritionId(athleteId, day);
  const deletedAt = isEmpty(data) ? new Date() : null;
  const row = await prisma.nutritionLog.upsert({
    where: { id },
    create: { id, athleteId, day, ...data, source: "coach", deletedAt },
    update: { ...data, source: "coach", deletedAt },
  });
  refresh();
  return deletedAt ? null : nutritionEntry(row);
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

/*
 * Injuries from the coach's side: one noted down at the gym, or the athlete's changed
 * (cleared up, say). Synced like weigh-ins, deletes as tombstones.
 */

export async function saveCoachInjury(athleteId: string, input: InjuryInput): Promise<InjuryData> {
  assertCoach();
  const data = cleanInjury(input);
  const row = input.id
    ? await prisma.injury.update({ where: { id: input.id, athleteId }, data })
    : await prisma.injury.create({ data: { ...data, athleteId, source: "coach" } });
  refresh();
  revalidatePath("/programming");
  return injuryData(row);
}

export async function deleteCoachInjury(id: string) {
  assertCoach();
  await prisma.injury.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  refresh();
  revalidatePath("/programming");
}

/*
 * Scheduling from the coach's side: the sessions the athlete moved (seen, or put back where
 * the plan has them) and meetings. Both sync row by row like weigh-ins; the athlete's phone
 * hears about meetings once the change reaches the server.
 */

function refreshSchedule() {
  refresh();
  revalidatePath("/programming");
}

/** The coach has seen these moves; the Schedule tab stops counting them. */
export async function markMovesSeen(athleteId: string, ids: string[]) {
  assertCoach();
  await prisma.sessionMove.updateMany({ where: { athleteId, id: { in: ids }, seenAt: null }, data: { seenAt: new Date() } });
  refreshSchedule();
}

/** Puts a moved session back on the day the plan has it. */
export async function undoMove(id: string) {
  assertCoach();
  await prisma.sessionMove.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), seenAt: new Date() } });
  refreshSchedule();
}

const coachToday = () => ymdOf(calendarToday());

/** A meeting the coach proposes. */
export async function proposeMeeting(athleteId: string, input: MeetingInput): Promise<MeetingData> {
  assertCoach();
  const row = await prisma.meeting.create({
    data: { ...cleanMeeting(input, coachToday()), athleteId, proposedBy: "coach", status: "PROPOSED" },
  });
  refreshSchedule();
  return meetingData(row);
}

/** Another day, time or place: proposes it afresh, for the athlete to answer. */
export async function rescheduleMeeting(id: string, input: MeetingInput): Promise<MeetingData> {
  assertCoach();
  const row = await prisma.meeting.update({
    where: { id, deletedAt: null },
    data: { ...cleanMeeting(input, coachToday()), proposedBy: "coach", status: "PROPOSED" },
  });
  refreshSchedule();
  return meetingData(row);
}

/** Answers the athlete's request. */
export async function answerAthleteMeeting(id: string, accept: boolean): Promise<MeetingData> {
  assertCoach();
  const held = await prisma.meeting.findFirst({ where: { id, deletedAt: null } });
  if (!held || waitingOn(meetingData(held)) !== "coach") throw new Error("That meeting isn't waiting on you.");
  const row = await prisma.meeting.update({ where: { id }, data: { status: accept ? "ACCEPTED" : "DECLINED" } });
  refreshSchedule();
  return meetingData(row);
}

/** Calls a meeting off; the athlete still sees it, marked as such. */
export async function cancelCoachMeeting(id: string) {
  assertCoach();
  await prisma.meeting.updateMany({ where: { id, deletedAt: null, status: { not: "CANCELLED" } }, data: { status: "CANCELLED" } });
  refreshSchedule();
}

/** Clears a meeting off the list altogether. */
export async function deleteCoachMeeting(id: string) {
  assertCoach();
  await prisma.meeting.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  refreshSchedule();
}
