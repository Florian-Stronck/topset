import { body, fail, json, withCoach } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * For the admin, on one team:
 * - `rename` gives it a new `name`.
 * - `add` and `remove` put a coach (`coachId`) on it or take them off. A coach taken off
 *   keeps their own athletes, still on the team; they just stop seeing the others'.
 * - `delete` ends it: its athletes go back to being their owners' alone. Nothing else goes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withCoach(
    request,
    async () => {
      const { id } = await params;
      const input = await body<{ action?: string; name?: unknown; coachId?: unknown }>(request, 1_000);
      if (!(await prisma.team.findUnique({ where: { id }, select: { id: true } }))) return fail("There's no team like that.", 404);
      const coachId = typeof input?.coachId === "string" ? input.coachId : "";

      switch (input?.action) {
        case "rename": {
          const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
          if (!name) return fail("A team needs a name.");
          await prisma.team.update({ where: { id }, data: { name } });
          return json({ ok: true });
        }
        case "add": {
          const coach = await prisma.coach.findUnique({ where: { id: coachId }, select: { passwordHash: true } });
          if (!coach || coach.passwordHash === null) return fail("There's no account like that.", 404);
          await prisma.teamMember.upsert({ where: { teamId_coachId: { teamId: id, coachId } }, create: { teamId: id, coachId }, update: {} });
          return json({ ok: true });
        }
        case "remove":
          await prisma.teamMember.deleteMany({ where: { teamId: id, coachId } });
          return json({ ok: true });
        case "delete":
          await prisma.$transaction([
            prisma.athlete.updateMany({ where: { teamId: id }, data: { teamId: null } }),
            prisma.teamMember.deleteMany({ where: { teamId: id } }),
            prisma.team.delete({ where: { id } }),
          ]);
          return json({ ok: true });
        default:
          return fail("Unknown action.");
      }
    },
    { admin: true },
  );
}
