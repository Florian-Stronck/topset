import { json, withCoach } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Ends this desktop app's sign-in; its token stops working. */
export async function POST(request: Request) {
  return withCoach(request, async (coach) => {
    await prisma.coachSession.deleteMany({ where: { id: coach.sessionId } });
    return json({ ok: true });
  });
}
