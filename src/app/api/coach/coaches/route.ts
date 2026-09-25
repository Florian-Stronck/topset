import { json, withCoach } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** For the admin: who has an account. Names and counts only, never anyone's training data. */
export async function GET(request: Request) {
  return withCoach(
    request,
    async () => {
      const coaches = await prisma.coach.findMany({
        where: { passwordHash: { not: null } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          username: true,
          isAdmin: true,
          disabledAt: true,
          _count: { select: { athletes: true } },
        },
      });
      return json({
        ok: true,
        coaches: coaches.map((c) => ({
          id: c.id,
          name: c.name,
          username: c.username,
          isAdmin: c.isAdmin,
          disabled: c.disabledAt !== null,
          athletes: c._count.athletes,
        })),
      });
    },
    { admin: true },
  );
}
