"use server";

import { revalidatePath } from "next/cache";
import { getAthleteByToken, getAthleteCalendar } from "@/lib/athlete-queries";
import { athleteToday } from "@/lib/athlete-today";
import { cleanMeeting, meetingData, waitingOn, type MeetingData, type MeetingInput } from "@/lib/meetings";
import { cleanReason, moveId, moveProblem } from "@/lib/moves";
import { prisma } from "@/lib/prisma";

/**
 * The athlete app's side of scheduling: moving a session to another day, and meetings with
 * the coach. Every call carries the athlete's token and only ever touches their own rows.
 */

async function athleteOf(token: string) {
  const athlete = await getAthleteByToken(token);
  if (!athlete) throw new Error("Not found.");
  return athlete;
}

/** The coach's desktop app pulls only once this moves; see `changed` in actions.ts. */
async function changed(token: string) {
  await prisma.coach.updateMany({
    where: { athletes: { some: { accessToken: token } } },
    data: { athleteVersion: { increment: 1 } },
  });
  revalidatePath(`/a/${token}`, "layout");
  revalidatePath("/tracking");
}

/**
 * Moves a session to another day, or back to where the plan puts it. The coach sees it in
 * Tracking; the plan itself is left alone. A session with sets checked off stays put.
 */
export async function moveSession(token: string, dayId: string, to: string, reason?: string | null): Promise<void> {
  const athlete = await athleteOf(token);
  const [today, { sessions }] = await Promise.all([athleteToday(), getAthleteCalendar(athlete)]);
  const session = sessions.find((s) => s.day.id === dayId);
  if (!session) throw new Error("Not found.");
  const planned = session.movedFrom ?? session.ymd;
  const logged = await prisma.setLog.count({ where: { done: true, row: { dayId } } });
  if (logged > 0) throw new Error("That session is already logged.");
  const taken = new Set(sessions.filter((s) => s.day.id !== dayId).map((s) => s.ymd));
  const problem = moveProblem(planned, to, today, taken);
  if (problem) throw new Error(problem);

  const id = moveId(dayId);
  const held = await prisma.sessionMove.findUnique({ where: { id }, select: { athleteId: true } });
  if (held && held.athleteId !== athlete.id) throw new Error("Not found.");
  if (to === planned) {
    await prisma.sessionMove.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  } else {
    const data = { fromDay: planned, day: to, reason: cleanReason(reason), seenAt: null, deletedAt: null };
    await prisma.sessionMove.upsert({ where: { id }, create: { id, athleteId: athlete.id, dayId, ...data }, update: data });
  }
  await changed(token);
}

async function meetingOf(token: string, id: string) {
  const athlete = await athleteOf(token);
  const row = await prisma.meeting.findFirst({ where: { id, athleteId: athlete.id, deletedAt: null } });
  if (!row) throw new Error("Not found.");
  return row;
}

/** Asks the coach for a meeting. */
export async function requestMeeting(token: string, input: MeetingInput): Promise<MeetingData> {
  const athlete = await athleteOf(token);
  const data = cleanMeeting(input, await athleteToday());
  const open = await prisma.meeting.count({ where: { athleteId: athlete.id, deletedAt: null, status: "PROPOSED", proposedBy: "athlete" } });
  if (open >= 10) throw new Error("Wait for your coach to answer the ones already sent.");
  const row = await prisma.meeting.create({ data: { ...data, athleteId: athlete.id, proposedBy: "athlete", status: "PROPOSED" } });
  await changed(token);
  return meetingData(row);
}

/** Answers the coach's proposal. */
export async function answerMeeting(token: string, id: string, accept: boolean): Promise<MeetingData> {
  const row = await meetingOf(token, id);
  if (waitingOn(meetingData(row)) !== "athlete") throw new Error("That meeting isn't waiting on you.");
  const next = await prisma.meeting.update({ where: { id }, data: { status: accept ? "ACCEPTED" : "DECLINED" } });
  await changed(token);
  return meetingData(next);
}

/** Another day, time or place: proposes it afresh, for the coach to answer. */
export async function changeMeeting(token: string, id: string, input: MeetingInput): Promise<MeetingData> {
  const row = await meetingOf(token, id);
  if (row.status === "CANCELLED") throw new Error("That meeting was called off.");
  const data = cleanMeeting(input, await athleteToday());
  const next = await prisma.meeting.update({ where: { id }, data: { ...data, proposedBy: "athlete", status: "PROPOSED" } });
  await changed(token);
  return meetingData(next);
}

/** Calls a meeting off, whoever proposed it. */
export async function cancelMeeting(token: string, id: string): Promise<void> {
  const row = await meetingOf(token, id);
  if (row.status === "CANCELLED") return;
  await prisma.meeting.update({ where: { id }, data: { status: "CANCELLED" } });
  await changed(token);
}
