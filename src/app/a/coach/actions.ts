"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createSession, normalizeUsername, sha256, verifyPassword, type SessionCoach } from "@/lib/auth";
import { cloudPrimary } from "@/lib/cloud";
import { allowTry, clearTries, slowDown } from "@/lib/coach-api";
import { loadSettings } from "@/lib/coach-settings";
import { writeBodyweight, writeInjury, writeNote, writeNutrition } from "@/lib/coach-writes";
import * as meets from "@/lib/competition-writes";
import * as programming from "@/app/programming/actions";
import * as athletes from "@/app/athletes/actions";
import * as links from "@/app/athletes/link-actions";
import type { BodyweightEntry } from "@/lib/bodyweight";
import type { Nutrient } from "@/lib/checkins";
import type { InjuryData, InjuryInput } from "@/lib/injuries";
import { cleanMeeting, meetingData, meetingNews, waitingOn, type MeetingData, type MeetingInput } from "@/lib/meetings";
import { cleanBody } from "@/lib/messages";
import type { NutritionEntry } from "@/lib/nutrition";
import { bumpVersion, logPlan, PHONE_COOKIE, signedInFor } from "@/lib/phone-coach";
import { prisma } from "@/lib/prisma";
import { notePlanChanges, notifyMeetings, notifyNotes } from "@/lib/push";
import { asSignedInCoach } from "@/lib/role";
import { messageData, type MessageData } from "@/lib/queries";
import { today as calendarToday, ymdOf } from "@/lib/dates";

/**
 * What the coach's phone can write: the desktop Tracking's actions, with the same names and
 * arguments, each checked against the signed-in coach's athletes and what they may do with
 * them (notes and review marks need review; the rest, edit). Every write also leaves what
 * the coach's desktop apps pull it by — see `phone-coach.ts`.
 */

/** Username and password in, a session cookie out; then on to the page asked for. */
export async function signIn(_: string | null, form: FormData): Promise<string | null> {
  if (!cloudPrimary()) return "Open this on your athlete app's address to sign in.";
  const username = normalizeUsername(String(form.get("username") ?? ""));
  const password = String(form.get("password") ?? "");
  const key = `login:${username}`;
  if (!(await allowTry(key))) return "Too many wrong tries. Wait 15 minutes and try again.";
  const coach = await prisma.coach.findUnique({ where: { username } });
  if (!coach || !(await verifyPassword(password, coach.passwordHash))) {
    await slowDown();
    return "Wrong username or password.";
  }
  await clearTries(key);
  if (coach.disabledAt) return "This account has been turned off. Ask your admin.";
  const token = await createSession(coach.id);
  (await cookies()).set(PHONE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/a/coach",
    // As long as a browser keeps any cookie: a phone stays signed in like a desktop app.
    maxAge: 400 * 86_400,
  });
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/a/coach") ? next : "/a/coach");
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(PHONE_COOKIE)?.value;
  if (token) await prisma.coachSession.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete({ name: PHONE_COOKIE, path: "/a/coach" });
  redirect("/a/coach");
}

/** Whose sessions these are; throws on one that doesn't exist. */
async function daysOf(dayIds: string[]) {
  const days = await prisma.day.findMany({ where: { id: { in: dayIds } }, select: { id: true, week: { select: { block: { select: { athleteId: true } } } } } });
  if (dayIds.length === 0 || days.length !== new Set(dayIds).size) throw new Error("Not found.");
  return days.map((d) => ({ id: d.id, athleteId: d.week.block.athleteId }));
}

/** Tells the athlete's phone about a note once the answer is on its way. */
function notify(m: MessageData, athleteId: string) {
  after(() => notifyNotes([{ id: m.id, athleteId, day: m.day, body: m.body }]).catch((e) => console.error("[topset] push", e)));
}

export async function markReviewed(dayIds: string[], reviewed: boolean): Promise<string | null> {
  const days = await daysOf(dayIds);
  const coach = await signedInFor(days.map((d) => d.athleteId), "review");
  const at = reviewed ? new Date() : null;
  await prisma.$transaction([prisma.day.updateMany({ where: { id: { in: dayIds } }, data: { reviewedAt: at } }), logPlan(coach, "Day", days)]);
  return at?.toISOString() ?? null;
}

export async function sendMessage(
  athleteId: string,
  dayId: string,
  day: string,
  body: string,
  rowId: string | null = null,
): Promise<{ message: MessageData; reviewedAt: string }> {
  const [session] = await daysOf([dayId]);
  if (session.athleteId !== athleteId) throw new Error("Not found.");
  if (rowId && !(await prisma.exerciseRow.findFirst({ where: { id: rowId, dayId }, select: { id: true } }))) throw new Error("Not found.");
  const coach = await signedInFor([athleteId], "review");
  const sent = await writeNote(athleteId, dayId, day, body, rowId, [logPlan(coach, "Day", [session]), bumpVersion(athleteId)]);
  notify(sent.message, athleteId);
  return sent;
}

export async function sendChatMessage(athleteId: string, body: string): Promise<MessageData> {
  await signedInFor([athleteId], "review");
  const [row] = await prisma.$transaction([
    prisma.coachMessage.create({ data: { athleteId, day: ymdOf(calendarToday()), body: cleanBody(body) } }),
    bumpVersion(athleteId),
  ]);
  const message = messageData(row);
  notify(message, athleteId);
  return message;
}

export async function markChatRead(athleteId: string) {
  await signedInFor([athleteId], "review");
  await prisma.$transaction([
    prisma.coachMessage.updateMany({ where: { athleteId, sender: "athlete", deletedAt: null, readAt: null }, data: { readAt: new Date() } }),
    bumpVersion(athleteId),
  ]);
}

/** The coach's own note, and the athlete it is to. */
async function noteOf(id: string) {
  const note = await prisma.coachMessage.findFirst({ where: { id, sender: "coach", deletedAt: null }, select: { athleteId: true } });
  if (!note) throw new Error("Not found.");
  await signedInFor([note.athleteId], "review");
  return note.athleteId;
}

export async function editMessage(id: string, body: string): Promise<MessageData> {
  const athleteId = await noteOf(id);
  const [row] = await prisma.$transaction([
    prisma.coachMessage.update({ where: { id, sender: "coach" }, data: { body: cleanBody(body), readAt: null } }),
    bumpVersion(athleteId),
  ]);
  const message = messageData(row);
  notify(message, athleteId);
  return message;
}

export async function deleteMessage(id: string) {
  const athleteId = await noteOf(id);
  await prisma.$transaction([prisma.coachMessage.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } }), bumpVersion(athleteId)]);
}

export async function addBodyweight(athleteId: string, day: string, weight: number): Promise<BodyweightEntry> {
  await signedInFor([athleteId], "edit");
  const entry = await writeBodyweight(athleteId, day, weight);
  await bumpVersion(athleteId);
  return entry;
}

export async function deleteBodyweight(id: string) {
  const row = await prisma.bodyweightLog.findFirst({ where: { id, deletedAt: null }, select: { athleteId: true } });
  if (!row) return;
  await signedInFor([row.athleteId], "edit");
  await prisma.$transaction([prisma.bodyweightLog.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } }), bumpVersion(row.athleteId)]);
}

export async function saveNutrition(athleteId: string, day: string, values: Partial<Record<Nutrient, unknown>>): Promise<NutritionEntry | null> {
  await signedInFor([athleteId], "edit");
  const entry = await writeNutrition(athleteId, day, values);
  await bumpVersion(athleteId);
  return entry;
}

export async function saveCoachInjury(athleteId: string, input: InjuryInput): Promise<InjuryData> {
  await signedInFor([athleteId], "edit");
  const injury = await writeInjury(athleteId, input);
  await bumpVersion(athleteId);
  return injury;
}

export async function deleteCoachInjury(id: string) {
  const row = await prisma.injury.findFirst({ where: { id, deletedAt: null }, select: { athleteId: true } });
  if (!row) return;
  await signedInFor([row.athleteId], "edit");
  await prisma.$transaction([prisma.injury.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } }), bumpVersion(row.athleteId)]);
}

const LIFTS = ["squat1RM", "bench1RM", "dead1RM"] as const;

/** The athlete's 1RMs, as Progress's "Use as the 1RM" sets them. */
export async function updateAthlete(athleteId: string, patch: Partial<Record<(typeof LIFTS)[number], number | null>>) {
  const coach = await signedInFor([athleteId], "edit");
  const data: Partial<Record<(typeof LIFTS)[number], number | null>> = {};
  for (const lift of LIFTS) {
    const v = patch[lift];
    if (v === undefined) continue;
    if (v !== null && (!Number.isFinite(v) || v <= 0 || v > 2000)) throw new Error("That weight doesn't look right.");
    data[lift] = v;
  }
  await prisma.$transaction([prisma.athlete.update({ where: { id: athleteId }, data }), logPlan(coach, "Athlete", [{ id: athleteId, athleteId }])]);
}

/** The athlete's own notes and division, as the Profile tab sets them. */
export async function updateProfile(athleteId: string, patch: { sex?: "M" | "F" | null; notes?: string | null }) {
  const coach = await signedInFor([athleteId], "edit");
  const data: { sex?: "M" | "F" | null; notes?: string | null } = {};
  if (patch.sex === null || patch.sex === "M" || patch.sex === "F") data.sex = patch.sex;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim().slice(0, 5000) || null;
  await prisma.$transaction([prisma.athlete.update({ where: { id: athleteId }, data }), logPlan(coach, "Athlete", [{ id: athleteId, athleteId }])]);
}

/*
 * Scheduling: moved sessions and meetings. Both merge row by row like notes; a meeting the
 * athlete should hear about goes to their phone, as it would after a desktop push.
 */

/** The athlete a row is under, once the signed-in coach may edit them. */
async function editable(row: { athleteId: string } | null) {
  if (!row) throw new Error("Not found.");
  await signedInFor([row.athleteId], "edit");
  return row.athleteId;
}

function tellAthlete(before: Record<string, unknown> | undefined, row: { id: string; athleteId: string; day: string; time: string }) {
  const news = meetingNews(before, row);
  if (news) after(() => notifyMeetings([{ id: row.id, athleteId: row.athleteId, day: row.day, time: row.time, news }]).catch((e) => console.error("[topset] push", e)));
}

export async function markMovesSeen(athleteId: string, ids: string[]) {
  await signedInFor([athleteId], "edit");
  await prisma.$transaction([prisma.sessionMove.updateMany({ where: { athleteId, id: { in: ids }, seenAt: null }, data: { seenAt: new Date() } }), bumpVersion(athleteId)]);
}

export async function undoMove(id: string) {
  const athleteId = await editable(await prisma.sessionMove.findFirst({ where: { id, deletedAt: null }, select: { athleteId: true } }));
  await prisma.$transaction([prisma.sessionMove.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), seenAt: new Date() } }), bumpVersion(athleteId)]);
}

export async function proposeMeeting(athleteId: string, input: MeetingInput): Promise<MeetingData> {
  await signedInFor([athleteId], "edit");
  const [row] = await prisma.$transaction([
    prisma.meeting.create({ data: { ...cleanMeeting(input, ymdOf(calendarToday())), athleteId, proposedBy: "coach", status: "PROPOSED" } }),
    bumpVersion(athleteId),
  ]);
  tellAthlete(undefined, row);
  return meetingData(row);
}

export async function rescheduleMeeting(id: string, input: MeetingInput): Promise<MeetingData> {
  const held = await prisma.meeting.findFirst({ where: { id, deletedAt: null } });
  const athleteId = await editable(held);
  const [row] = await prisma.$transaction([
    prisma.meeting.update({ where: { id }, data: { ...cleanMeeting(input, ymdOf(calendarToday())), proposedBy: "coach", status: "PROPOSED" } }),
    bumpVersion(athleteId),
  ]);
  tellAthlete(held!, row);
  return meetingData(row);
}

export async function answerAthleteMeeting(id: string, accept: boolean): Promise<MeetingData> {
  const held = await prisma.meeting.findFirst({ where: { id, deletedAt: null } });
  const athleteId = await editable(held);
  if (waitingOn(meetingData(held!)) !== "coach") throw new Error("That meeting isn't waiting on you.");
  const [row] = await prisma.$transaction([prisma.meeting.update({ where: { id }, data: { status: accept ? "ACCEPTED" : "DECLINED" } }), bumpVersion(athleteId)]);
  tellAthlete(held!, row);
  return meetingData(row);
}

export async function cancelCoachMeeting(id: string) {
  const held = await prisma.meeting.findFirst({ where: { id, deletedAt: null, status: { not: "CANCELLED" } } });
  if (!held) return;
  const athleteId = await editable(held);
  const [row] = await prisma.$transaction([prisma.meeting.update({ where: { id }, data: { status: "CANCELLED" } }), bumpVersion(athleteId)]);
  tellAthlete(held, row);
}

export async function deleteCoachMeeting(id: string) {
  const held = await prisma.meeting.findFirst({ where: { id, deletedAt: null } });
  if (!held) return;
  const athleteId = await editable(held);
  const [row] = await prisma.$transaction([prisma.meeting.update({ where: { id }, data: { deletedAt: new Date() } }), bumpVersion(athleteId)]);
  tellAthlete(held, row);
}

/*
 * Meets. The writes are the desktop's own (`competition-writes.ts`); after each, the meet and
 * its attempts — and the athlete, when their 1RMs or racks changed — go into the plan log,
 * and a checklist change moves the athlete counter.
 */

/** The meet's athlete, once the signed-in coach may edit them; their settings round the weights. */
async function meetFor(meetId: string) {
  const meet = await prisma.meet.findUnique({ where: { id: meetId }, select: { athleteId: true } });
  if (!meet) throw new Error("Not found.");
  const coach = await signedInFor([meet.athleteId], "edit");
  await loadSettings(coach.id);
  return { coach, athleteId: meet.athleteId };
}

async function logMeet(coach: SessionCoach, athleteId: string, meetId: string) {
  const attempts = await prisma.attempt.findMany({ where: { meetId }, select: { id: true } });
  await prisma.$transaction([
    logPlan(coach, "Meet", [{ id: meetId, athleteId }]),
    logPlan(coach, "Attempt", attempts.map((a) => ({ id: a.id, athleteId }))),
  ]);
}

type Args<F extends (...args: never[]) => unknown> = Parameters<F>;

export async function createMeet(input: Args<typeof meets.createMeet>[0]) {
  const coach = await signedInFor([input.athleteId], "edit");
  await loadSettings(coach.id);
  const id = await meets.createMeet(input);
  await logMeet(coach, input.athleteId, id);
  return id;
}

export async function updateMeet(meetId: string, patch: Args<typeof meets.updateMeet>[1]) {
  const { coach, athleteId } = await meetFor(meetId);
  await meets.updateMeet(meetId, patch);
  await logMeet(coach, athleteId, meetId);
  // The checklist is dated by the meet.
  if (patch.date) await bumpVersion(athleteId);
}

export async function setRack(athleteId: string, brand: string, patch: Args<typeof meets.setRack>[2]) {
  const coach = await signedInFor([athleteId], "edit");
  await meets.setRack(athleteId, brand, patch);
  await logPlan(coach, "Athlete", [{ id: athleteId, athleteId }]);
}

export async function setReminder(...args: Args<typeof meets.setReminder>) {
  const { coach, athleteId } = await meetFor(args[0]);
  await meets.setReminder(...args);
  await logMeet(coach, athleteId, args[0]);
}

export async function addTasks(...args: Args<typeof meets.addTasks>) {
  const { athleteId } = await meetFor(args[0]);
  await meets.addTasks(...args);
  await bumpVersion(athleteId);
}

export async function addUsualTasks(meetId: string) {
  const { athleteId } = await meetFor(meetId);
  await meets.addUsualTasks(meetId);
  await bumpVersion(athleteId);
}

export async function tickTask(id: string, done: boolean) {
  const athleteId = await editable(await prisma.meetTask.findFirst({ where: { id, deletedAt: null }, select: { athleteId: true } }));
  await meets.tickTask(id, done);
  await bumpVersion(athleteId);
}

export async function removeTask(id: string) {
  const athleteId = await editable(await prisma.meetTask.findFirst({ where: { id, deletedAt: null }, select: { athleteId: true } }));
  await meets.removeTask(id);
  await bumpVersion(athleteId);
}

export async function setThirds(...args: Args<typeof meets.setThirds>) {
  const { coach, athleteId } = await meetFor(args[0]);
  await meets.setThirds(...args);
  await logMeet(coach, athleteId, args[0]);
}

export async function deleteMeet(meetId: string) {
  const { coach, athleteId } = await meetFor(meetId);
  const attempts = await prisma.attempt.findMany({ where: { meetId }, select: { id: true } });
  await meets.deleteMeet(meetId);
  // Logged once gone, so the desktop apps read them as removed.
  await prisma.$transaction([
    logPlan(coach, "Meet", [{ id: meetId, athleteId }]),
    logPlan(coach, "Attempt", attempts.map((a) => ({ id: a.id, athleteId }))),
    bumpVersion(athleteId),
  ]);
}

export async function updateAttempt(...args: Args<typeof meets.updateAttempt>) {
  const { coach, athleteId } = await meetFor(args[0]);
  await meets.updateAttempt(...args);
  await logMeet(coach, athleteId, args[0]);
}

export async function planFromMaxes(meetId: string) {
  const { coach, athleteId } = await meetFor(meetId);
  await meets.planFromMaxes(meetId);
  await logMeet(coach, athleteId, meetId);
}

export async function applyResultsAsMaxes(meetId: string) {
  const { coach, athleteId } = await meetFor(meetId);
  await meets.applyResultsAsMaxes(meetId);
  await logPlan(coach, "Athlete", [{ id: athleteId, athleteId }]);
}

/*
 * The plan: a session's rows and the day itself, edited on the phone through the desktop's
 * own Programming actions, so week syncing and progression rules do what they do there.
 * Every week, day, row and rule of the phase goes into the plan log afterwards (before and
 * after, so a deleted row reads as removed), and the athlete hears of the change once the
 * coach stops editing, as after a desktop push.
 */

type PlanPlace = { rowId: string } | { dayId: string } | { blockId: string };

async function phaseOf(where: PlanPlace) {
  const blockId =
    "blockId" in where
      ? where.blockId
      : "rowId" in where
        ? (await prisma.exerciseRow.findUnique({ where: { id: where.rowId }, select: { day: { select: { week: { select: { blockId: true } } } } } }))?.day.week.blockId
        : (await prisma.day.findUnique({ where: { id: where.dayId }, select: { week: { select: { blockId: true } } } }))?.week.blockId;
  const block = blockId ? await prisma.block.findUnique({ where: { id: blockId }, select: { id: true, athleteId: true } }) : null;
  if (!block) throw new Error("Not found.");
  return block;
}

async function phaseRows(blockId: string) {
  const weeks = await prisma.week.findMany({
    where: { blockId },
    select: { id: true, days: { select: { id: true, rows: { select: { id: true, rules: { select: { id: true } } } } } } },
  });
  const days = weeks.flatMap((w) => w.days);
  const rows = days.flatMap((d) => d.rows);
  return { Week: weeks.map((w) => w.id), Day: days.map((d) => d.id), ExerciseRow: rows.map((r) => r.id), ProgressionRule: rows.flatMap((r) => r.rules.map((x) => x.id)) };
}

async function editPlan<T>(where: PlanPlace, run: () => Promise<T>): Promise<T> {
  const { id: blockId, athleteId } = await phaseOf(where);
  const coach = await signedInFor([athleteId], "edit");
  await loadSettings(coach.id);
  const before = await phaseRows(blockId);
  const out = await asSignedInCoach(run);
  const now = await phaseRows(blockId);
  const tables = ["Week", "Day", "ExerciseRow", "ProgressionRule"] as const;
  await prisma.$transaction(
    tables.map((table) => logPlan(coach, table, [...new Set([...before[table], ...now[table]])].map((id) => ({ id, athleteId })))),
  );
  after(() => notePlanChanges(coach.id, [athleteId]).catch((e) => console.error("[topset] plan notice", e)));
  return out;
}

/** What the coach writes on a row; the athlete's own columns stay theirs. */
const PLAN_CELLS = ["sets", "reps", "repsMax", "intensityType", "intensity", "intensityMax", "coachNotes", "tempo", "restTime", "videoUrl", "duration", "load"] as const;

export async function updateCell(rowId: string, patch: programming.CellPatch) {
  const plan = Object.fromEntries(PLAN_CELLS.filter((k) => k in patch).map((k) => [k, patch[k]])) as programming.CellPatch;
  await editPlan({ rowId }, () => programming.updateCell(rowId, plan));
}

export async function updateRow(rowId: string, patch: { exercise?: string }) {
  const exercise = patch.exercise?.trim().slice(0, 120);
  if (!exercise) return;
  await editPlan({ rowId }, () => programming.updateRow(rowId, { exercise }));
}

export async function addRow(dayId: string, exercise: string) {
  await editPlan({ dayId }, () => programming.addRow(dayId, { exercise: exercise.trim().slice(0, 120) || undefined }));
}

export async function moveRow(rowId: string, direction: "up" | "down") {
  await editPlan({ rowId }, () => programming.moveRow(rowId, direction === "up" ? "up" : "down"));
}

export async function deleteRow(rowId: string) {
  await editPlan({ rowId }, () => programming.deleteRow(rowId));
}

export async function updateDay(dayId: string, patch: { label?: string; rest?: boolean }) {
  const label = patch.label?.trim().slice(0, 60);
  await editPlan({ dayId }, () =>
    programming.updateDay(dayId, { ...(label ? { label } : {}), ...(typeof patch.rest === "boolean" ? { rest: patch.rest } : {}) }),
  );
}

/*
 * The athlete app's setup: check-in questions and the check-in link, through the desktop's
 * own actions. Questions and the link live on plan rows (CheckinQuestion, Athlete), so they
 * go into the plan log the same way.
 */

async function questionIds(athleteId: string) {
  return (await prisma.checkinQuestion.findMany({ where: { athleteId }, select: { id: true } })).map((q) => q.id);
}

async function editQuestions<T>(athleteId: string, run: () => Promise<T>): Promise<T> {
  const coach = await signedInFor([athleteId], "edit");
  await loadSettings(coach.id);
  const before = await questionIds(athleteId);
  const out = await asSignedInCoach(run);
  const ids = [...new Set([...before, ...(await questionIds(athleteId))])];
  await logPlan(coach, "CheckinQuestion", ids.map((id) => ({ id, athleteId })));
  return out;
}

async function questionAthlete(id: string) {
  const q = await prisma.checkinQuestion.findUnique({ where: { id }, select: { athleteId: true } });
  if (!q) throw new Error("Not found.");
  return q.athleteId;
}

export async function addCheckinQuestion(...args: Args<typeof athletes.addCheckinQuestion>) {
  return editQuestions(args[0], () => athletes.addCheckinQuestion(...args));
}

export async function updateCheckinQuestion(...args: Args<typeof athletes.updateCheckinQuestion>) {
  return editQuestions(await questionAthlete(args[0]), () => athletes.updateCheckinQuestion(...args));
}

export async function removeCheckinQuestion(id: string) {
  return editQuestions(await questionAthlete(id), () => athletes.removeCheckinQuestion(id));
}

export async function reorderCheckinQuestions(athleteId: string, ids: string[]) {
  return editQuestions(athleteId, () => athletes.reorderCheckinQuestions(athleteId, ids));
}

export async function athleteLink(athleteId: string, kind: links.LinkKind = "athlete") {
  await signedInFor([athleteId], "view");
  return asSignedInCoach(() => links.athleteLink(athleteId, kind));
}

/** A new check-in link, or none: the Athlete row changes, so it goes into the plan log. */
async function editLink(athleteId: string, run: () => Promise<links.AthleteLink>) {
  const coach = await signedInFor([athleteId], "edit");
  await loadSettings(coach.id);
  const out = await asSignedInCoach(run);
  await logPlan(coach, "Athlete", [{ id: athleteId, athleteId }]);
  return out;
}

export async function createAccessLink(athleteId: string) {
  return editLink(athleteId, () => links.createAccessLink(athleteId));
}

export async function revokeAccessLink(athleteId: string) {
  return editLink(athleteId, () => links.revokeAccessLink(athleteId));
}

/*
 * Progression rules, weeks, phases and programs: the desktop's own Programming actions
 * again. A rule or a week stays inside one phase, logged as `editPlan` logs it; a new
 * phase or program adds blocks, so `editProgram` logs the athlete's programs and phases
 * and everything inside the ones that are new.
 */

const FIELDS = ["SETS", "REPS", "INTENSITY", "DURATION", "LOAD"] as const;
const OPS = ["ADD", "MULTIPLY"] as const;
type RuleInput = Parameters<typeof programming.addRule>[1];

function cleanRule<T extends Partial<RuleInput> & { enabled?: boolean }>(rule: T): T {
  const whole = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min;
  if (rule.field !== undefined && !FIELDS.includes(rule.field)) throw new Error("Not a rule.");
  if (rule.op !== undefined && !OPS.includes(rule.op)) throw new Error("Not a rule.");
  if (rule.amount !== undefined && (!Number.isFinite(rule.amount) || Math.abs(rule.amount) > 1000)) throw new Error("Not a rule.");
  if (rule.everyWeeks !== undefined && !whole(rule.everyWeeks, 1)) throw new Error("Not a rule.");
  if (rule.startWeek !== undefined && !whole(rule.startWeek, 1)) throw new Error("Not a rule.");
  if (rule.endWeek !== undefined && rule.endWeek !== null && !whole(rule.endWeek, 1)) throw new Error("Not a rule.");
  if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") throw new Error("Not a rule.");
  return rule;
}

async function ruleRow(ruleId: string) {
  const rule = await prisma.progressionRule.findUnique({ where: { id: ruleId }, select: { rowId: true } });
  if (!rule) throw new Error("Not found.");
  return rule.rowId;
}

export async function addRule(rowId: string, rule: RuleInput) {
  return editPlan({ rowId }, () => programming.addRule(rowId, cleanRule({ field: rule.field, op: rule.op, amount: rule.amount, everyWeeks: rule.everyWeeks, startWeek: rule.startWeek, endWeek: rule.endWeek })));
}

export async function updateRule(ruleId: string, patch: Parameters<typeof programming.updateRule>[1]) {
  return editPlan({ rowId: await ruleRow(ruleId) }, () => programming.updateRule(ruleId, cleanRule({ ...patch })));
}

export async function deleteRule(ruleId: string) {
  await editPlan({ rowId: await ruleRow(ruleId) }, () => programming.deleteRule(ruleId));
}

export async function addWeek(blockId: string) {
  await editPlan({ blockId }, () => programming.addWeek(blockId));
}

/** A copy of one week, added after the phase's last. */
export async function duplicateWeek(weekId: string) {
  const week = await prisma.week.findUnique({ where: { id: weekId }, select: { blockId: true } });
  if (!week) throw new Error("Not found.");
  await editPlan({ blockId: week.blockId }, () => programming.pasteWeek(weekId, week.blockId));
}

export async function deleteWeek(blockId: string, week: number) {
  if (!Number.isInteger(week) || week < 1) throw new Error("Not found.");
  await editPlan({ blockId }, () => programming.deleteWeek(blockId, week));
}

async function editProgram<T>(athleteId: string, run: () => Promise<T>): Promise<T> {
  const coach = await signedInFor([athleteId], "edit");
  await loadSettings(coach.id);
  const blocksOf = async () => (await prisma.block.findMany({ where: { athleteId }, select: { id: true } })).map((b) => b.id);
  const before = new Set(await blocksOf());
  const out = await asSignedInCoach(run);
  const [programs, blocks] = await Promise.all([prisma.program.findMany({ where: { athleteId }, select: { id: true } }), blocksOf()]);
  const fresh = await Promise.all(blocks.filter((id) => !before.has(id)).map(phaseRows));
  const rows = (ids: string[]) => ids.map((id) => ({ id, athleteId }));
  await prisma.$transaction([
    logPlan(coach, "Program", rows(programs.map((p) => p.id))),
    logPlan(coach, "Block", rows(blocks)),
    ...(["Week", "Day", "ExerciseRow", "ProgressionRule"] as const).map((table) => logPlan(coach, table, rows(fresh.flatMap((f) => f[table])))),
  ]);
  after(() => notePlanChanges(coach.id, [athleteId]).catch((e) => console.error("[topset] plan notice", e)));
  return out;
}

/** The next phase of a program, starting the day the last one ends. */
export async function addPhase(programId: string) {
  const program = await prisma.program.findUnique({ where: { id: programId }, select: { athleteId: true } });
  if (!program) throw new Error("Not found.");
  return editProgram(program.athleteId, () => programming.addPhase(programId));
}

export async function createProgram(input: { athleteId: string; name: string; startDate: string; weeks: number }) {
  const name = input.name.trim().slice(0, 80) || "Program";
  const weeks = Math.min(16, Math.max(1, Math.round(input.weeks)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new Error("That day isn't a date.");
  return editProgram(input.athleteId, () =>
    programming.createProgram({ athleteId: input.athleteId, name, startDate: input.startDate, phases: [{ phase: "", weeks }] }),
  );
}
