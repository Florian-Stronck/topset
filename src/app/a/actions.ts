"use server";

import { revalidatePath } from "next/cache";
import { getAthleteByToken, rowForToken } from "@/lib/athlete-queries";
import { bodyweightEntry, type BodyweightEntry } from "@/lib/bodyweight";
import { asksOn, cleanScore, parseDays, READINESS_FIELDS, type ReadinessEntry, type ReadinessKey } from "@/lib/readiness";
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
 * The readiness check-in for a day, one score or the note at a time as the athlete taps.
 * Only on a day the coach asks for it; a check-in taken back and filled in again comes
 * back to life rather than making a second one.
 */
export async function saveReadiness(
  token: string,
  day: string,
  patch: Partial<Record<ReadinessKey, number | null>> & { note?: string | null },
): Promise<ReadinessEntry> {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error("That day isn't a date.");
  if (!asksOn(parseDays(athlete.readinessDays), day)) throw new Error("Your coach doesn't ask for this today.");

  const data: Partial<Record<ReadinessKey, number | null>> & { note?: string | null } = {};
  for (const { key } of READINESS_FIELDS) if (key in patch) data[key] = cleanScore(patch[key]);
  if ("note" in patch) data.note = patch.note?.trim().slice(0, 500) || null;

  const row = await prisma.readinessLog.upsert({
    where: { athleteId_day: { athleteId: athlete.id, day } },
    create: { athleteId: athlete.id, day, ...data },
    update: { ...data, deletedAt: null },
    select: { id: true, day: true, sleep: true, stress: true, soreness: true, energy: true, note: true },
  });
  await changed(token);
  return row;
}
