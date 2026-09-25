import { createSession, hashPassword, MIN_PASSWORD, normalizeUsername, sameSecret, validUsername } from "@/lib/auth";
import { cloudPrimary } from "@/lib/cloud";
import { body, fail, json, notFound, slowDown } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/role";

export const dynamic = "force-dynamic";

/**
 * A new coach account, with an invite code from the admin. The very first account is the
 * admin's own: it needs the setup code from the server's settings, and takes over the
 * data that was in the database before accounts existed.
 */
export async function POST(request: Request) {
  if (!cloudPrimary()) return notFound();
  const input = await body<{ username?: string; password?: string; name?: string; code?: string }>(request, 10_000);
  const username = normalizeUsername(String(input?.username ?? ""));
  const password = String(input?.password ?? "");
  const name = String(input?.name ?? "").trim().slice(0, 80) || username;
  const code = String(input?.code ?? "").trim().toUpperCase();

  if (!validUsername(username)) {
    return fail("Pick a username of 2 to 32 letters, digits, dots, dashes or underscores.");
  }
  if (password.length < MIN_PASSWORD) return fail(`Use at least ${MIN_PASSWORD} characters for the password.`);
  if (await prisma.coach.findFirst({ where: { username, passwordHash: { not: null } } })) {
    return fail("That username is taken. Pick another, or sign in if it's yours.");
  }

  const setup = serverEnv("ADMIN_SETUP_CODE");
  const hasAdmin = (await prisma.coach.count({ where: { isAdmin: true } })) > 0;
  const passwordHash = await hashPassword(password);

  if (!hasAdmin && setup && sameSecret(code, setup.toUpperCase())) {
    // The coach who used Topset before accounts: their data becomes the admin's.
    const legacy = await prisma.coach.findFirst({ where: { passwordHash: null }, orderBy: { id: "asc" } });
    const clash = await prisma.coach.findUnique({ where: { username } });
    if (clash && clash.id !== legacy?.id) return fail("That username is taken. Pick another.");
    const admin = legacy
      ? await prisma.coach.update({
          where: { id: legacy.id },
          data: { username, passwordHash, isAdmin: true, name: legacy.name || name },
        })
      : await prisma.coach.create({ data: { username, name, passwordHash, isAdmin: true } });
    const token = await createSession(admin.id);
    return json({ ok: true, token, coach: { id: admin.id, name: admin.name, username: admin.username, isAdmin: true } });
  }

  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    await slowDown();
    return fail("That invite code isn't valid. Ask your admin for a new one.", 403);
  }
  if (await prisma.coach.findUnique({ where: { username } })) return fail("That username is taken. Pick another.");

  const coach = await prisma
    .$transaction(async (tx) => {
      const made = await tx.coach.create({ data: { username, name, passwordHash } });
      // Claimed in the same transaction: a code only ever makes one account.
      const used = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date(), usedBy: made.id },
      });
      if (used.count !== 1) throw new Error("used");
      return made;
    })
    .catch(() => null);
  if (!coach) return fail("That invite code was just used.", 409);

  const token = await createSession(coach.id);
  return json({ ok: true, token, coach: { id: coach.id, name: coach.name, username: coach.username, isAdmin: false } });
}
