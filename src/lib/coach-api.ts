import { NextResponse } from "next/server";
import { coachFromRequest, sha256, type SessionCoach } from "@/lib/auth";
import { cloudPrimary } from "@/lib/cloud";
import { prisma } from "@/lib/prisma";

/**
 * Shared bits of the coach API on the Topset server: the routes desktop apps sign in and
 * sync through. On a desktop app these routes don't exist.
 */

export const notFound = () => new NextResponse(null, { status: 404 });

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const fail = (error: string, status = 400) => json({ ok: false, error }, status);

/** Runs `handler` for a signed-in coach, or answers why not. */
export async function withCoach(
  request: Request,
  handler: (coach: SessionCoach) => Promise<Response>,
  { admin = false } = {},
): Promise<Response> {
  if (!cloudPrimary()) return notFound();
  const coach = await coachFromRequest(request);
  if (!coach) return fail("Signed out. Sign in again in Settings.", 401);
  if (admin && !coach.isAdmin) return fail("Only the admin can do that.", 403);
  return handler(coach);
}

/** Request bodies are small JSON objects; anything else is refused. */
export async function body<T>(request: Request, limit = 4_000_000): Promise<T | null> {
  const text = await request.text();
  if (text.length > limit) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

/** A failed sign-in answers a little slower, so guessing is slow too. */
export const slowDown = () => new Promise((r) => setTimeout(r, 400 + Math.random() * 300));

const MAX_TRIES = 10;
const LOCK_MS = 15 * 60 * 1000;

/**
 * Counts a sign-in try against `key` (a username, or the setup code) and says whether it may
 * go ahead. After ten wrong tries in a row the key is locked until 15 minutes pass without
 * one. Counted before the password is checked, so guesses sent all at once count too.
 */
export async function allowTry(key: string): Promise<boolean> {
  const now = new Date();
  await prisma.loginAttempt.deleteMany({ where: { key, lastAt: { lt: new Date(now.getTime() - LOCK_MS) } } });
  const row = await prisma.loginAttempt.upsert({
    where: { key },
    create: { key, tries: 1, lastAt: now },
    update: { tries: { increment: 1 }, lastAt: now },
  });
  return row.tries <= MAX_TRIES;
}

/** A right answer starts the count again. */
export const clearTries = (key: string) => prisma.loginAttempt.deleteMany({ where: { key } });

/** The setup code's own count, keyed by a hash of it so a new code starts unlocked. */
export const setupKey = (setup: string) => `setup:${sha256(setup.trim().toUpperCase()).slice(0, 12)}`;

export const locked = () => fail("Too many wrong tries. Wait 15 minutes and try again.", 429);
