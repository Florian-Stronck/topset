import { createSession, hashPassword, MIN_PASSWORD, normalizeUsername, sameSecret, sha256 } from "@/lib/auth";
import { cloudPrimary } from "@/lib/cloud";
import { body, fail, json, notFound, slowDown } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/role";

export const dynamic = "force-dynamic";

/**
 * A forgotten password: the reset code the admin made for this account, and a new
 * password. Every old sign-in ends, and this computer is signed in afresh.
 *
 * The admin's own way back is the server's setup code (TOPSET_ADMIN_SETUP_CODE, kept in the
 * hosting settings). With it, the username may even be left out: the server's admin is found
 * without it, and the answer names the account, so a forgotten username is recovered too.
 */
export async function POST(request: Request) {
  if (!cloudPrimary()) return notFound();
  const input = await body<{ username?: string; code?: string; password?: string }>(request, 10_000);
  const username = normalizeUsername(String(input?.username ?? ""));
  const code = String(input?.code ?? "").trim().toUpperCase();
  const password = String(input?.password ?? "");
  if (password.length < MIN_PASSWORD) return fail(`Use at least ${MIN_PASSWORD} characters for the password.`);

  const setup = serverEnv("ADMIN_SETUP_CODE").trim().toUpperCase();
  if (setup && code && sameSecret(code, setup)) {
    const admins = await prisma.coach.findMany({
      where: { isAdmin: true, passwordHash: { not: null }, ...(username ? { username } : {}) },
      take: 2,
    });
    if (admins.length === 0) {
      await slowDown();
      return fail(username ? "That username isn't an admin account." : "This server has no admin yet. Create the account instead.", 403);
    }
    if (admins.length > 1) return fail("This server has more than one admin. Enter your username as well.");
    return renew(admins[0], password);
  }

  const coach = username ? await prisma.coach.findUnique({ where: { username } }) : null;
  const valid =
    coach &&
    !coach.disabledAt &&
    coach.resetCodeHash !== null &&
    coach.resetExpiresAt !== null &&
    coach.resetExpiresAt > new Date() &&
    coach.resetCodeHash === sha256(code);
  if (!valid) {
    await slowDown();
    return fail("That reset code isn't valid for this username. Ask your admin for a new one.", 403);
  }
  return renew(coach, password);
}

/** A new password, every old sign-in ended, and this computer signed in. */
async function renew(
  coach: { id: string; name: string; username: string; isAdmin: boolean },
  password: string,
) {
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.coach.update({ where: { id: coach.id }, data: { passwordHash, resetCodeHash: null, resetExpiresAt: null } }),
    prisma.coachSession.deleteMany({ where: { coachId: coach.id } }),
  ]);
  const token = await createSession(coach.id);
  return json({ ok: true, token, coach: { id: coach.id, name: coach.name, username: coach.username, isAdmin: coach.isAdmin } });
}
