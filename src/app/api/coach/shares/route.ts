import { inviteCode } from "@/lib/auth";
import { allowTry, body, clearTries, fail, json, locked, withCoach } from "@/lib/coach-api";
import { isRole } from "@/lib/roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Share codes still open for the coach's own athletes. */
export async function GET(request: Request) {
  return withCoach(request, async (coach) => {
    const codes = await prisma.shareCode.findMany({
      where: { athlete: { coachId: coach.id }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: "desc" },
      select: { code: true, athleteId: true, role: true, reusable: true, expiresAt: true },
    });
    return json({ ok: true, codes });
  });
}

/**
 * Sharing one athlete with another coach:
 * - `code`: the owner makes a code for `athleteId` with a `role`, used once or (`reusable`)
 *   until it expires in `days`, or never (`days: null`).
 * - `redeem`: another coach enters a `code` and gets the athlete with its role.
 * - `role`: the owner changes what `coachId` may do with `athleteId`.
 * - `remove`: the owner stops sharing `athleteId` with `coachId`, or that coach leaves it.
 * - `dropCode`: the owner withdraws a `code`.
 */
export async function POST(request: Request) {
  return withCoach(request, async (coach) => {
    const input = await body<Record<string, unknown>>(request, 2_000);
    const str = (key: string) => (typeof input?.[key] === "string" ? (input[key] as string) : "");
    const athleteId = str("athleteId");
    const ownsAthlete = async () =>
      Boolean(await prisma.athlete.findFirst({ where: { id: athleteId, coachId: coach.id }, select: { id: true } }));

    switch (input?.action) {
      case "code": {
        const role = input.role;
        const days = input.days === null ? null : Number(input.days);
        if (!isRole(role)) return fail("Pick view, review or edit.");
        if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)) return fail("A code lasts 1 to 365 days, or until you delete it.");
        if (!(await ownsAthlete())) return fail("Only the coach who added an athlete can share them. Wait for sync if you just added them.", 403);
        const code = await prisma.shareCode.create({
          data: { code: inviteCode(), athleteId, role, reusable: input.reusable === true, expiresAt: days === null ? null : new Date(Date.now() + days * DAY_MS) },
          select: { code: true, athleteId: true, role: true, reusable: true, expiresAt: true },
        });
        return json({ ok: true, code });
      }
      case "redeem": {
        // Codes are guessable only by brute force, and this caps it per coach.
        const key = `share:${coach.id}`;
        if (!(await allowTry(key))) return locked();
        const share = await prisma.shareCode.findUnique({ where: { code: str("code").trim().toUpperCase() }, include: { athlete: { select: { coachId: true, name: true } } } });
        if (!share || (share.expiresAt && share.expiresAt <= new Date())) return fail("That code doesn't work. Check it, or ask for a new one.", 404);
        if (share.athlete.coachId === coach.id) return fail("That athlete is already yours.");
        if (!isRole(share.role)) return fail("That code doesn't work. Ask for a new one.");
        await prisma.$transaction([
          prisma.athleteShare.upsert({
            where: { athleteId_coachId: { athleteId: share.athleteId, coachId: coach.id } },
            create: { athleteId: share.athleteId, coachId: coach.id, role: share.role },
            update: { role: share.role },
          }),
          ...(share.reusable ? [] : [prisma.shareCode.delete({ where: { code: share.code } })]),
        ]);
        await clearTries(key);
        return json({ ok: true, athlete: share.athlete.name, role: share.role });
      }
      case "role": {
        if (!isRole(input.role)) return fail("Pick view, review or edit.");
        if (!(await ownsAthlete())) return fail("Only the coach who added an athlete can change who sees them.", 403);
        await prisma.athleteShare.updateMany({ where: { athleteId, coachId: str("coachId") }, data: { role: input.role } });
        return json({ ok: true });
      }
      case "remove": {
        const coachId = str("coachId");
        if (coachId !== coach.id && !(await ownsAthlete())) return fail("Only the coach who added an athlete can change who sees them.", 403);
        await prisma.athleteShare.deleteMany({ where: { athleteId, coachId } });
        return json({ ok: true });
      }
      case "dropCode":
        await prisma.shareCode.deleteMany({ where: { code: str("code"), athlete: { coachId: coach.id } } });
        return json({ ok: true });
      default:
        return fail("Unknown action.");
    }
  });
}
