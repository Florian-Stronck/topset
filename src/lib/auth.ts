import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Coach accounts on the Topset server. A desktop app signs in once with username and password
 * and keeps a long-lived token; the server only ever stores hashes of either.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [kind, salt, hash] = (stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const key = await scrypt(password, Buffer.from(salt, "base64"));
  const want = Buffer.from(hash, "base64");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

export const MIN_PASSWORD = 8;

/**
 * A username as it is stored: trimmed and lowercase, so `Anna` and `anna` are one account.
 * Someone typing the email they used to sign in with gets the part before the @, which is
 * what their account was renamed to when usernames replaced emails.
 */
export function normalizeUsername(input: string): string {
  const name = input.trim().toLowerCase();
  const at = name.indexOf("@");
  return at > 0 ? name.slice(0, at) : name;
}

/** Letters, digits, dots, dashes and underscores; 2 to 32 of them. */
export function validUsername(username: string): boolean {
  return /^[a-z0-9._-]{2,32}$/.test(username);
}

export const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

/** A new sign-in for a coach; the token is returned once and only its hash is kept. */
export async function createSession(coachId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.coachSession.create({ data: { coachId, tokenHash: sha256(token) } });
  return token;
}

export type SessionCoach = { id: string; name: string; username: string; isAdmin: boolean; sessionId: string };

/** The coach a request is signed in as, from its `Authorization: Bearer …` header. */
export async function coachFromRequest(request: Request): Promise<SessionCoach | null> {
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const session = await prisma.coachSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { coach: { select: { id: true, name: true, username: true, isAdmin: true, disabledAt: true } } },
  });
  // A turned-off account has its sessions deleted too; this is the belt to those braces.
  if (!session || session.coach.disabledAt) return null;
  // Kept roughly current without a write on every sync.
  if (Date.now() - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
    await prisma.coachSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  const { id, name, username, isAdmin } = session.coach;
  return { id, name, username, isAdmin, sessionId: session.id };
}

/** A short code a person can read out or type: no 0/O or 1/I to mix up. */
export function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

/** Compares a secret in constant time, so a wrong guess says nothing about the right one. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(x, y);
}
