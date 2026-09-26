"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAthleteByToken, rowForToken } from "@/lib/athlete-queries";
import {
  CLIP_TYPES,
  cleanSetIndex,
  clipType,
  MAX_CLIP_BYTES,
  MAX_CLIPS_PER_DAY,
  MAX_CLIPS_PER_ROW,
  retentionDays,
  type ClipView,
} from "@/lib/athlete-videos";
import { bodyweightEntry, type BodyweightEntry } from "@/lib/bodyweight";
import { answerDay, asksOn, cleanAnswer, questionData } from "@/lib/checkins";
import { prisma } from "@/lib/prisma";
import { PUSH_KINDS, type PushPrefs } from "@/lib/push-kinds";
import { rowActuals } from "@/lib/setlog";
import { deleteObject, objectSize, presign, storageConfig } from "@/lib/storage";

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

/** The athlete opened their coach's notes: these ones, or every one still unread. */
export async function markRead(token: string, ids?: string[]) {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  const { count } = await prisma.coachMessage.updateMany({
    where: { athleteId: athlete.id, deletedAt: null, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  if (count > 0) await changed(token);
}

/** A phone's push sign-up, as the browser's `PushSubscription.toJSON()` gives it. */
export type PushSignup = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Enough phones for anyone; past it the oldest sign-up gives way. */
const MAX_PHONES = 5;

function prefsOf(sub: PushPrefs): PushPrefs {
  return Object.fromEntries(PUSH_KINDS.map((k) => [k, sub[k]])) as PushPrefs;
}

function cleanZone(timeZone: unknown): string | null {
  if (typeof timeZone !== "string" || timeZone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}

/**
 * Notifications on for this phone, or it checking in again: signs it up (or takes over its
 * earlier sign-up) and answers with what it has chosen to hear about.
 */
export async function subscribePush(token: string, signup: PushSignup, timeZone?: string): Promise<PushPrefs> {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  const { endpoint, keys } = signup ?? {};
  const short = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!short(endpoint, 1000) || !endpoint.startsWith("https://") || !short(keys?.p256dh, 200) || !short(keys?.auth, 100)) {
    throw new Error("That isn't a push sign-up.");
  }
  const zone = cleanZone(timeZone);
  // One endpoint is one phone: signing up again (or on a new link) takes it over.
  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { athleteId: athlete.id, token, endpoint, p256dh: keys.p256dh, auth: keys.auth, timeZone: zone },
    update: { athleteId: athlete.id, token, p256dh: keys.p256dh, auth: keys.auth, ...(zone ? { timeZone: zone } : {}) },
  });
  const extra = await prisma.pushSubscription.findMany({
    where: { athleteId: athlete.id },
    orderBy: { createdAt: "desc" },
    skip: MAX_PHONES,
    select: { id: true },
  });
  if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  return prefsOf(sub);
}

/** What this phone wants to hear about. */
export async function setPushPrefs(token: string, endpoint: string, prefs: Partial<PushPrefs>): Promise<PushPrefs> {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  const data = Object.fromEntries(PUSH_KINDS.filter((k) => typeof prefs?.[k] === "boolean").map((k) => [k, prefs[k]]));
  await prisma.pushSubscription.updateMany({ where: { athleteId: athlete.id, endpoint }, data });
  const sub = await prisma.pushSubscription.findFirst({ where: { athleteId: athlete.id, endpoint } });
  if (!sub) throw new Error("Not found.");
  return prefsOf(sub);
}

/** Notifications off for this phone. */
export async function unsubscribePush(token: string, endpoint: string) {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  await prisma.pushSubscription.deleteMany({ where: { athleteId: athlete.id, endpoint } });
}

/** How long the phone has to start an upload once it has its link. */
const UPLOAD_LINK_SECONDS = 15 * 60;

export type ClipUpload = { id: string; url: string; contentType: string };

/** What the clip actions answer: the result, or why not in words the athlete can read. */
export type ClipResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A thrown error's message would be hidden from the phone in production; this hands it over. */
async function answer<T>(work: () => Promise<T>): Promise<ClipResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

/**
 * Makes room for a video of one exercise and hands back a link the phone uploads it to,
 * straight to storage. The link only takes a file of exactly this type and size, into
 * this one slot, for a few minutes; `finishClip` then checks it arrived.
 */
export async function startClip(
  token: string,
  rowId: string,
  day: string,
  file: { name: string; type: string; size: number },
  setIndex: number | null = null,
): Promise<ClipResult<ClipUpload>> {
  return answer(() => reserveClip(token, rowId, day, file, cleanSetIndex(setIndex)));
}

async function reserveClip(
  token: string,
  rowId: string,
  day: string,
  file: { name: string; type: string; size: number },
  setIndex: number | null,
): Promise<ClipUpload> {
  const config = storageConfig();
  if (!config) throw new Error("Videos aren't set up on this server.");
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  await owned(token, rowId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error("That day isn't a date.");
  const contentType = clipType(String(file.type ?? ""), String(file.name ?? ""));
  if (!contentType) throw new Error("That isn't a video Topset can take.");
  if (!Number.isInteger(file.size) || file.size <= 0) throw new Error("That video is empty.");
  if (file.size > MAX_CLIP_BYTES) throw new Error("That video is too large.");

  // Unfinished uploads count for an hour, so a dropped connection doesn't use up the row.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const since = new Date(Date.now() - retentionDays() * 86_400_000);
  const [onRow, today] = await Promise.all([
    prisma.athleteVideo.count({
      where: { rowId, deletedAt: null, OR: [{ uploadedAt: { gt: since } }, { uploadedAt: null, createdAt: { gt: hourAgo } }] },
    }),
    prisma.athleteVideo.count({ where: { athleteId: athlete.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } }),
  ]);
  if (onRow >= MAX_CLIPS_PER_ROW) throw new Error("This exercise has as many videos as it can take.");
  if (today >= MAX_CLIPS_PER_DAY) throw new Error("That's enough videos for today.");

  const name = String(file.name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) || "video";
  const storageKey = `v/${athlete.id}/${rowId}/${crypto.randomUUID()}.${CLIP_TYPES[contentType]}`;
  const row = await prisma.athleteVideo.create({
    data: { athleteId: athlete.id, rowId, day, setIndex, name, contentType, size: file.size, storageKey },
  });
  const url = presign(config, {
    method: "PUT",
    key: storageKey,
    expiresIn: UPLOAD_LINK_SECONDS,
    headers: { "Content-Type": contentType, "Content-Length": String(file.size) },
  });
  return { id: row.id, url, contentType };
}

/** The upload is in: checked against storage, it becomes a video the coach gets. */
export async function finishClip(token: string, id: string): Promise<ClipResult<ClipView>> {
  return answer(() => confirmClip(token, id));
}

async function confirmClip(token: string, id: string): Promise<ClipView> {
  const config = storageConfig();
  if (!config) throw new Error("Videos aren't set up on this server.");
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  const clip = await prisma.athleteVideo.findFirst({ where: { id, athleteId: athlete.id, deletedAt: null } });
  if (!clip) throw new Error("Not found.");

  const size = await objectSize(config, clip.storageKey);
  if (size === null) throw new Error("The video didn't arrive. Try again.");
  if (size > MAX_CLIP_BYTES) {
    await deleteObject(config, clip.storageKey).catch(() => {});
    await prisma.athleteVideo.update({ where: { id }, data: { deletedAt: new Date() } });
    throw new Error("That video is too large.");
  }
  const uploadedAt = clip.uploadedAt ?? new Date();
  await prisma.athleteVideo.update({ where: { id }, data: { size, uploadedAt } });
  await changed(token);
  return {
    id,
    name: clip.name,
    setIndex: clip.setIndex,
    size,
    uploadedAt: uploadedAt.toISOString(),
    url: presign(config, { method: "GET", key: clip.storageKey, expiresIn: 6 * 60 * 60 }),
    daysLeft: retentionDays(),
  };
}

/**
 * Takes a video back: gone from storage, and a tombstone so the coach's app knows. A copy
 * the coach's app already downloaded stays on their computer.
 */
export async function deleteClip(token: string, id: string) {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  const clip = await prisma.athleteVideo.findFirst({ where: { id, athleteId: athlete.id, deletedAt: null } });
  if (!clip) return;
  await prisma.athleteVideo.update({ where: { id }, data: { deletedAt: new Date() } });
  const config = storageConfig();
  if (config) await deleteObject(config, clip.storageKey).catch(() => {});
  await changed(token);
}

/** Says which set a video shows, or that it's none in particular (null). */
export async function setClipSet(token: string, id: string, setIndex: number | null) {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  const { count } = await prisma.athleteVideo.updateMany({
    where: { id, athleteId: athlete.id, deletedAt: null },
    data: { setIndex: cleanSetIndex(setIndex) },
  });
  if (count > 0) await changed(token);
}
