import { body, fail, json, withCoach } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** For the admin: every team, with who is on it and how many athletes it shares. */
export async function GET(request: Request) {
  return withCoach(
    request,
    async () => {
      const teams = await prisma.team.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, members: { select: { coachId: true } }, _count: { select: { athletes: true } } },
      });
      return json({
        ok: true,
        teams: teams.map((t) => ({ id: t.id, name: t.name, coaches: t.members.map((m) => m.coachId), athletes: t._count.athletes })),
      });
    },
    { admin: true },
  );
}

/** For the admin: a new, empty team. */
export async function POST(request: Request) {
  return withCoach(
    request,
    async () => {
      const input = await body<{ name?: unknown }>(request, 1_000);
      const name = typeof input?.name === "string" ? input.name.trim().slice(0, 80) : "";
      if (!name) return fail("A team needs a name.");
      const team = await prisma.team.create({ data: { name }, select: { id: true } });
      return json({ ok: true, id: team.id });
    },
    { admin: true },
  );
}
