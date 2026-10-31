import type { Prisma } from "@prisma/client";
import { bodyweightEntry, type BodyweightEntry } from "@/lib/bodyweight";
import { NUTRIENTS, type Nutrient } from "@/lib/checkins";
import { cleanInjury, injuryData, type InjuryData, type InjuryInput } from "@/lib/injuries";
import { cleanBody } from "@/lib/messages";
import { cleanAmount, isEmpty, nutritionEntry, nutritionId, type NutritionEntry } from "@/lib/nutrition";
import { prisma } from "@/lib/prisma";
import { messageData, type MessageData } from "@/lib/queries";

/**
 * The coach's writes that check what they're given, shared by the desktop app's actions and
 * the coach's phone (`/a/coach`). Who may make them is the caller's to check.
 */

const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day));

export async function writeBodyweight(athleteId: string, day: string, weight: number): Promise<BodyweightEntry> {
  if (!isDay(day)) throw new Error("That day isn't a date.");
  if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) throw new Error("That weight doesn't look right.");
  const row = await prisma.bodyweightLog.create({
    data: { athleteId, day, weight: Number(weight.toFixed(2)), source: "coach" },
  });
  return bodyweightEntry(row);
}

/** A day's totals; clearing every number deletes the day, as a tombstone. */
export async function writeNutrition(athleteId: string, day: string, values: Partial<Record<Nutrient, unknown>>): Promise<NutritionEntry | null> {
  if (!isDay(day)) throw new Error("That day isn't a date.");
  const data = Object.fromEntries(NUTRIENTS.map((n) => [n, cleanAmount(n, values[n])])) as Record<Nutrient, number | null>;
  const id = nutritionId(athleteId, day);
  const deletedAt = isEmpty(data) ? new Date() : null;
  const row = await prisma.nutritionLog.upsert({
    where: { id },
    create: { id, athleteId, day, ...data, source: "coach", deletedAt },
    update: { ...data, source: "coach", deletedAt },
  });
  return deletedAt ? null : nutritionEntry(row);
}

/** A note about one session, which marks it reviewed; `also` goes in the same transaction. */
export async function writeNote(
  athleteId: string,
  dayId: string,
  day: string,
  body: string,
  rowId: string | null,
  also: Prisma.PrismaPromise<unknown>[] = [],
): Promise<{ message: MessageData; reviewedAt: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("That day isn't a date.");
  const text = cleanBody(body);
  const now = new Date();
  const [row] = await prisma.$transaction([
    prisma.coachMessage.create({ data: { athleteId, day, dayId, rowId, body: text } }),
    prisma.day.update({ where: { id: dayId }, data: { reviewedAt: now } }),
    ...also,
  ]);
  return { message: messageData(row), reviewedAt: now.toISOString() };
}

export async function writeInjury(athleteId: string, input: InjuryInput): Promise<InjuryData> {
  const data = cleanInjury(input);
  const row = input.id
    ? await prisma.injury.update({ where: { id: input.id, athleteId }, data })
    : await prisma.injury.create({ data: { ...data, athleteId, source: "coach" } });
  return injuryData(row);
}
