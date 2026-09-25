"use server";

import { revalidatePath } from "next/cache";
import { getAthleteByToken, rowForToken } from "@/lib/athlete-queries";
import { bodyweightEntry, type BodyweightEntry } from "@/lib/bodyweight";
import { answerDay, asksOn, cleanAnswer, questionData } from "@/lib/checkins";
import { prisma } from "@/lib/prisma";
import { rowActuals } from "@/lib/setlog";

/**
 * What the athlete app can write. Every call carries the athlete's token and is checked
 * against the row it touches, so a link can only ever log into its own plan.
 */

export type SetPatch = {
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null;
  rir?: number | null;
  done?: boolean;
  /** Flagged as a personal record. */
  pr?: boolean;
};

const MAX_SETS = 30;

function clean(patch: SetPatch): SetPatch {
  const num = (v: number | null | undefined, max: number, int = false) => {
    if (v === undefined) return undefined;
    if (v === null || !Number.isFinite(v) || v < 0 || v > max) return null;
    return int ? Math.round(v) : Number(v.toFixed(2));
  };
  return {
    weight: num(patch.weight, 2000),
    reps: num(patch.reps, 200, true),
    rpe: num(patch.rpe, 10),
    rir: num(patch.rir, 10),
    done: typeof patch.done === "boolean" ? patch.done : undefined,
    pr: typeof patch.pr === "boolean" ? patch.pr : undefined,
  };
}

async function owned(token: string, rowId: string, setIndex?: number) {
  const row = await rowForToken(token, rowId);
  if (!row) throw new Error("Not found.");
  if (setIndex !== undefined && (!Number.isInteger(setIndex) || setIndex < 0 || setIndex >= MAX_SETS)) {
    throw new Error("Not found.");
  }
  return row;
}

/** Keeps the row's own "logged" columns in step with its sets — see `rowActuals`. */
async function syncRow(rowId: string) {
  const logs = await prisma.setLog.findMany({ where: { rowId } });
  await prisma.exerciseRow.update({ where: { id: rowId }, data: rowActuals(logs) });
}

/**
 * After every write: the coach's desktop app asks for their athletes' logs only when this
 * counter has moved. It goes up last, once the write is in, so a pull that sees the new
 * number also sees what it stands for.
 */
async function changed(token: string) {
  await prisma.coach.updateMany({
    where: { athletes: { some: { accessToken: token } } },
    data: { athleteVersion: { increment: 1 } },
  });
  revalidatePath("/tracking");
  revalidatePath("/overview");
}

export async function logSet(token: string, rowId: string, setIndex: number, patch: SetPatch) {
  await owned(token, rowId, setIndex);
  const data = clean(patch);
  await prisma.setLog.upsert({
    where: { rowId_setIndex: { rowId, setIndex } },
    create: { rowId, setIndex, ...data, done: data.done ?? false },
    update: data,
  });
  await syncRow(rowId);
  await changed(token);
}

/**
 * Several sets of one row at once — the whole exercise logged from its weight and effort
 * fields, or ticked off in one tap. One round of writes rather than one per set.
 */
export async function logSets(token: string, rowId: string, sets: { setIndex: number; patch: SetPatch }[]) {
  if (sets.length === 0 || sets.length > MAX_SETS) throw new Error("Not found.");
  await owned(token, rowId);
  for (const { setIndex } of sets) {
    if (!Number.isInteger(setIndex) || setIndex < 0 || setIndex >= MAX_SETS) throw new Error("Not found.");
  }
  await prisma.$transaction(
    sets.map(({ setIndex, patch }) => {
      const data = clean(patch);
      return prisma.setLog.upsert({
        where: { rowId_setIndex: { rowId, setIndex } },
        create: { rowId, setIndex, ...data, done: data.done ?? false },
        update: data,
      });
    }),
  );
  await syncRow(rowId);
  await changed(token);
}

/** Drops an extra set. Prescribed sets are only ever unchecked, never removed. */
export async function removeSet(token: string, rowId: string, setIndex: number) {
  const row = await owned(token, rowId, setIndex);
  if (setIndex < Math.max(1, row.sets ?? 1)) throw new Error("Prescribed sets stay.");
  await prisma.setLog.deleteMany({ where: { rowId, setIndex } });
  // Later extras close the gap, so the set numbers stay 1, 2, 3… (rowId, setIndex) is
  // unique and SQLite checks it row by row, so they go up out of the way first — past
  // MAX_SETS, where nothing lives — and come down one below where they started.
  await prisma.$transaction([
    prisma.setLog.updateMany({ where: { rowId, setIndex: { gt: setIndex } }, data: { setIndex: { increment: MAX_SETS } } }),
    prisma.setLog.updateMany({ where: { rowId, setIndex: { gte: MAX_SETS } }, data: { setIndex: { decrement: MAX_SETS + 1 } } }),
  ]);
  await syncRow(rowId);
  await changed(token);
}

export async function saveAthleteNotes(token: string, rowId: string, notes: string | null) {
  await owned(token, rowId);
  const text = notes?.trim().slice(0, 1000) || null;
  await prisma.exerciseRow.update({ where: { id: rowId }, data: { athleteNotes: text } });
  await changed(token);
}

/** Heavier than any lifter, in kg or lb, is a typo. */
const MAX_BODYWEIGHT = 1000;

/** A weigh-in, for the day given — any day up to today on the athlete's phone. */
export async function logBodyweight(token: string, day: string, weight: number, note?: string | null): Promise<BodyweightEntry> {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error("That day isn't a date.");
  if (!Number.isFinite(weight) || weight <= 0 || weight > MAX_BODYWEIGHT) throw new Error("That weight doesn't look right.");
  const row = await prisma.bodyweightLog.create({
    data: {
      athleteId: athlete.id,
      day,
      weight: Number(weight.toFixed(2)),
      note: note?.trim().slice(0, 200) || null,
      source: "athlete",
    },
  });
  await changed(token);
  return bodyweightEntry(row);
}

/** Takes a weigh-in back. It stays as a tombstone so the coach's copy drops it too. */
export async function deleteBodyweight(token: string, id: string) {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  const { count } = await prisma.bodyweightLog.updateMany({
    where: { id, athleteId: athlete.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (count > 0) await changed(token);
}

/**
 * One check-in answer, as the athlete gives it: for a question of theirs, on a day it is
 * asked, up to today. Null takes the answer back — it stays as a tombstone so the coach's
 * copy drops it too — and answering again brings it back rather than making a second.
 */
export async function saveCheckinAnswer(token: string, questionId: string, day: string, raw: unknown): Promise<string | null> {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error("That day isn't a date.");
  const row = await prisma.checkinQuestion.findFirst({ where: { id: questionId, athleteId: athlete.id } });
  if (!row) throw new Error("Not found.");
  const question = questionData(row);
  if (!asksOn(question, day)) throw new Error("Your coach doesn't ask this that day.");

  const value = cleanAnswer(question, raw);
  const filed = answerDay(question, day);
  const key = { questionId_day: { questionId, day: filed } };
  if (value === null) {
    await prisma.checkinAnswer.updateMany({ where: { questionId, day: filed, deletedAt: null }, data: { deletedAt: new Date() } });
  } else {
    await prisma.checkinAnswer.upsert({
      where: key,
      create: { athleteId: athlete.id, questionId, day: filed, value },
      update: { value, deletedAt: null },
    });
  }
  await changed(token);
  return value;
}
