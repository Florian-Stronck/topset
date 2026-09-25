import { createSession, normalizeUsername, verifyPassword } from "@/lib/auth";
import { cloudPrimary } from "@/lib/cloud";
import { body, fail, json, notFound, slowDown } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Username and password in, a token for this desktop app out. */
export async function POST(request: Request) {
  if (!cloudPrimary()) return notFound();
  // `email` is what a desktop app from before usernames still sends.
  const input = await body<{ username?: string; email?: string; password?: string }>(request, 10_000);
  const username = normalizeUsername(String(input?.username ?? input?.email ?? ""));
  const password = String(input?.password ?? "");

  const coach = await prisma.coach.findUnique({ where: { username } });
  if (!coach || !(await verifyPassword(password, coach.passwordHash))) {
    await slowDown();
    return fail("Wrong username or password.", 401);
  }
  if (coach.disabledAt) return fail("This account has been turned off. Ask your admin.", 403);
  const token = await createSession(coach.id);
  return json({ ok: true, token, coach: { id: coach.id, name: coach.name, username: coach.username, isAdmin: coach.isAdmin } });
}
