import { cache } from "react";
import { cookies } from "next/headers";
import { coachFromToken, type SessionCoach } from "@/lib/auth";
import { cloudPrimary } from "@/lib/cloud";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";
import { shareOf, type AthleteShareInfo } from "@/lib/share";

/**
 * The coach's phone: the `/a/coach` pages on the Topset server, signed in with the coach's
 * own account. A cookie holds a session like a desktop app's token. What the phone writes
 * goes into the server's database the way a sync push would, so the coach's desktop apps
 * (and the coaches an athlete is shared with) pull it: plan rows through the PlanChange
 * log, merged rows (notes, weigh-ins…) through the athleteVersion counter.
 */

export const PHONE_COOKIE = "topset-coach";

/** The coach signed in on this phone; null when signed out, or not on the server. */
export const phoneCoach = cache(async (): Promise<SessionCoach | null> => {
  if (!cloudPrimary()) return null;
  const token = (await cookies()).get(PHONE_COOKIE)?.value;
  return token ? coachFromToken(token) : null;
});

const ATHLETE = {
  id: true,
  coachId: true,
  name: true,
  unit: true,
  squat1RM: true,
  bench1RM: true,
  dead1RM: true,
  variationPct: true,
  variationPcts: true,
  rpeTable: true,
  activeProgramId: true,
  accessToken: true,
  sex: true,
  notes: true,
  shares: { select: { coachId: true, role: true } },
  coach: { select: { name: true } },
} as const;

/** The coach's own athletes and the ones shared with them, as the desktop app sees them. */
const theirs = (coachId: string) => ({ OR: [{ coachId }, { shares: { some: { coachId } } }], coach: { disabledAt: null } });

export async function phoneAthletes(coachId: string) {
  const rows = await prisma.athlete.findMany({ where: theirs(coachId), select: ATHLETE, orderBy: { name: "asc" } });
  return rows.map((a) => ({ ...a, share: shareOf(a, coachId) }));
}

export async function phoneAthlete(coachId: string, athleteId: string) {
  const a = await prisma.athlete.findFirst({ where: { id: athleteId, ...theirs(coachId) }, select: ATHLETE });
  return a && { ...a, share: shareOf(a, coachId) };
}

export type Need = "view" | "review" | "edit";

/** Whether a share (or owning the athlete) allows `need`: review covers notes and marks, edit the rest. */
export const allows = (role: AthleteShareInfo["role"], need: Need) => (role === "own" ? true : ROLES.indexOf(role) >= ROLES.indexOf(need));

/** The coach signed in on this phone, if they may do `need` to every one of these athletes; throws otherwise. */
export async function signedInFor(athleteIds: string[], need: Need): Promise<SessionCoach> {
  const coach = await phoneCoach();
  if (!coach) throw new Error("Signed out. Sign in again.");
  const ids = [...new Set(athleteIds)];
  const found = await prisma.athlete.findMany({
    where: { id: { in: ids }, ...theirs(coach.id) },
    select: { id: true, coachId: true, shares: { select: { coachId: true, role: true } }, coach: { select: { name: true } } },
  });
  if (ids.length === 0 || found.length !== ids.length || !found.every((a) => allows(shareOf(a, coach.id).role, need))) throw new Error("Not found.");
  return coach;
}

/** Plan rows changed on the phone, for the desktop apps to pull (see `planData`). */
export function logPlan(
  coach: SessionCoach,
  table: "Athlete" | "Meet" | "Attempt" | "Program" | "Block" | "Week" | "Day" | "ExerciseRow" | "ProgressionRule" | "CheckinQuestion",
  rows: { id: string; athleteId: string }[]) {
  return prisma.planChange.createMany({
    data: rows.map((r) => ({ coachId: coach.id, table, rowId: r.id, sessionId: coach.sessionId, athleteId: r.athleteId })),
  });
}

/** Merged rows changed on the phone: the athlete's coaches' desktop apps pull them next (see `athleteData`). */
export function bumpVersion(athleteId: string) {
  return prisma.coach.updateMany({
    where: { OR: [{ athletes: { some: { id: athleteId } } }, { shares: { some: { athleteId } } }] },
    data: { athleteVersion: { increment: 1 } },
  });
}
