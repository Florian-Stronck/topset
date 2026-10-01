import { body, fail, json, withCoach } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Shares one of the coach's own athletes with a team they're on (`teamId`), or keeps them
 * to the coach alone (`teamId: null`). Only the athlete's owner can.
 */
export async function POST(request: Request) {
  return withCoach(request, async (coach) => {
    const input = await body<{ athleteId?: unknown; teamId?: unknown }>(request, 1_000);
    const athleteId = typeof input?.athleteId === "string" ? input.athleteId : "";
    const teamId = typeof input?.teamId === "string" && input.teamId ? input.teamId : null;
    const athlete = await prisma.athlete.findUnique({ where: { id: athleteId }, select: { coachId: true } });
    if (!athlete) return fail("There's no athlete like that here yet. Wait for sync, then try again.", 404);
    if (athlete.coachId !== coach.id) return fail("Only the coach who added an athlete can share them.", 403);
    if (teamId && !(await prisma.teamMember.findUnique({ where: { teamId_coachId: { teamId, coachId: coach.id } } }))) {
      return fail("You're not on that team.", 403);
    }
    await prisma.athlete.update({ where: { id: athleteId }, data: { teamId } });
    return json({ ok: true });
  });
}
