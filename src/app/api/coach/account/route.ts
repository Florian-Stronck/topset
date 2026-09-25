import { hashPassword, MIN_PASSWORD, verifyPassword } from "@/lib/auth";
import { cloudClient } from "@/lib/cloud";
import { body, fail, json, slowDown, withCoach } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";
import { deleteCoach } from "@/lib/sync-server";

export const dynamic = "force-dynamic";

/** How many computers are signed in to this account, this one included. */
export async function GET(request: Request) {
  return withCoach(request, async (coach) => {
    const sessions = await prisma.coachSession.count({ where: { coachId: coach.id } });
    return json({ ok: true, sessions });
  });
}

/**
 * The signed-in coach's own account:
 * - `password` changes it, given the current one, and signs every other computer out;
 * - `sign-out-others` just does the latter;
 * - `delete`, given the password, erases the account and everything in it on the server.
 *   The last admin can't: the server would be left with nobody to run it.
 */
export async function POST(request: Request) {
  return withCoach(request, async (coach) => {
    const input = await body<{ action?: string; current?: string; next?: string; password?: string }>(request, 10_000);
    const others = prisma.coachSession.deleteMany({ where: { coachId: coach.id, id: { not: coach.sessionId } } });

    if (input?.action === "sign-out-others") {
      const { count } = await others;
      return json({ ok: true, signedOut: count });
    }

    if (input?.action === "password") {
      const next = String(input.next ?? "");
      if (next.length < MIN_PASSWORD) return fail(`Use at least ${MIN_PASSWORD} characters for the password.`);
      const stored = await prisma.coach.findUnique({ where: { id: coach.id }, select: { passwordHash: true } });
      if (!(await verifyPassword(String(input.current ?? ""), stored?.passwordHash ?? null))) {
        await slowDown();
        return fail("Your current password isn't right.", 403);
      }
      const passwordHash = await hashPassword(next);
      const [, { count }] = await prisma.$transaction([
        prisma.coach.update({ where: { id: coach.id }, data: { passwordHash, resetCodeHash: null, resetExpiresAt: null } }),
        others,
      ]);
      return json({ ok: true, signedOut: count });
    }

    if (input?.action === "delete") {
      const stored = await prisma.coach.findUnique({ where: { id: coach.id }, select: { passwordHash: true } });
      if (!(await verifyPassword(String(input.password ?? ""), stored?.passwordHash ?? null))) {
        await slowDown();
        return fail("Your password isn't right.", 403);
      }
      if (coach.isAdmin && (await prisma.coach.count({ where: { isAdmin: true } })) <= 1) {
        return fail("You're the server's only admin, so your account can't be deleted.");
      }
      const client = cloudClient();
      try {
        await deleteCoach(client, coach.id);
      } finally {
        client.close();
      }
      return json({ ok: true });
    }

    return fail("Unknown action.");
  });
}
