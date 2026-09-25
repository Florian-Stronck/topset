import { inviteCode, sha256 } from "@/lib/auth";
import { cloudClient } from "@/lib/cloud";
import { body, fail, json, withCoach } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";
import { deleteCoach } from "@/lib/sync-server";

export const dynamic = "force-dynamic";

/** How long a password reset code works. */
const RESET_HOURS = 48;

/**
 * For the admin, on one coach's account:
 * - `revoke` turns it off: every sign-in ends, no new ones, and their athletes' links stop.
 *   Nothing is deleted.
 * - `restore` turns it back on.
 * - `reset` makes a one-time code the coach sets a new password with. Only its hash is kept;
 *   the code itself is answered once, for the admin to pass on.
 * - `delete` erases the account and everything in it, so the username is free again.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withCoach(
    request,
    async (admin) => {
      const { id } = await params;
      const input = await body<{ action?: string }>(request, 1_000);
      const coach = await prisma.coach.findUnique({ where: { id }, select: { id: true, isAdmin: true, passwordHash: true } });
      if (!coach || coach.passwordHash === null) return fail("There's no account like that.", 404);

      switch (input?.action) {
        case "revoke": {
          if (coach.id === admin.id) return fail("You can't turn off your own account.");
          if (coach.isAdmin) return fail("An admin's account can't be turned off.");
          await prisma.$transaction([
            prisma.coach.update({
              where: { id },
              data: { disabledAt: new Date(), resetCodeHash: null, resetExpiresAt: null },
            }),
            prisma.coachSession.deleteMany({ where: { coachId: id } }),
          ]);
          return json({ ok: true });
        }
        case "restore":
          await prisma.coach.update({ where: { id }, data: { disabledAt: null } });
          return json({ ok: true });
        case "reset": {
          const code = inviteCode();
          const expiresAt = new Date(Date.now() + RESET_HOURS * 60 * 60 * 1000);
          await prisma.coach.update({ where: { id }, data: { resetCodeHash: sha256(code), resetExpiresAt: expiresAt } });
          return json({ ok: true, code, expiresAt });
        }
        case "delete": {
          if (coach.id === admin.id) return fail("Delete your own account under Password and sign-in.");
          if (coach.isAdmin) return fail("An admin's account can't be deleted from here.");
          const client = cloudClient();
          try {
            await deleteCoach(client, id);
          } finally {
            client.close();
          }
          return json({ ok: true });
        }
        default:
          return fail("Unknown action.");
      }
    },
    { admin: true },
  );
}
