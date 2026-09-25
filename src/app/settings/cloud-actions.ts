"use server";

import { revalidatePath } from "next/cache";
import { updateSettings } from "@/app/settings/actions";
import { assertCoach } from "@/lib/role";
import {
  api,
  readConfig,
  resetSync,
  ServerError,
  startSync,
  stopSync,
  syncNow,
  syncStatus,
  writeConfig,
  type CloudConfig,
} from "@/lib/sync";

/**
 * The desktop app's side of coach accounts: signing in to the Topset server, and, for the
 * admin, inviting coaches. The server's address is the athlete app address: one site
 * serves both.
 */

export type AccountStatus = {
  /** Only the desktop app signs in. */
  canSignIn: boolean;
  signedIn: { username: string; name: string; isAdmin: boolean; server: string } | null;
  lastSync: number | null;
  syncError: string | null;
};

export async function accountStatus(): Promise<AccountStatus> {
  assertCoach();
  const config = readConfig();
  const { lastSync, error } = syncStatus();
  return {
    canSignIn: Boolean(process.env.TOPSET_CLOUD_FILE),
    signedIn: config ? { username: config.username, name: config.name, isAdmin: config.isAdmin, server: config.server } : null,
    lastSync,
    syncError: error,
  };
}

type Result = { ok: boolean; message: string };
/** `email` is what a server from before usernames still answers with. */
type Session = { token: string; coach: { id: string; name: string; username?: string; email?: string; isAdmin: boolean } };

const usernameOf = (coach: Session["coach"]) => coach.username ?? String(coach.email ?? "").split("@")[0];

function serverOf(input: string): string | null {
  const url = input.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/.test(url) ? url : null;
}

async function begin(server: string, session: Session): Promise<Result> {
  const config: CloudConfig = {
    server,
    token: session.token,
    coachId: session.coach.id,
    username: usernameOf(session.coach),
    name: session.coach.name,
    isAdmin: session.coach.isAdmin,
    seeded: false,
  };
  stopSync();
  writeConfig(config);
  startSync();
  const { error } = await syncNow();
  // Athlete links point at the same site. Set after the first sync, which may have
  // brought this account's settings down from the server.
  await updateSettings({ athleteAppUrl: server });
  revalidatePath("/", "layout");
  return error
    ? { ok: false, message: `Signed in, but the first sync failed: ${error}` }
    : { ok: true, message: `Signed in as ${usernameOf(session.coach)}.` };
}

const message = (error: unknown) => (error instanceof ServerError || error instanceof Error ? error.message : String(error));

export async function signIn(input: { server: string; username: string; password: string }): Promise<Result> {
  assertCoach();
  const server = serverOf(input.server);
  if (!server) return { ok: false, message: "Enter the server address, e.g. https://topset-yourname.vercel.app." };
  try {
    const session = await api<Session>(server, "login", {
      method: "POST",
      body: { username: input.username, password: input.password },
    });
    return await begin(server, session);
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/** A new account with an invite code (or, the very first time, the admin setup code). */
export async function createAccount(input: {
  server: string;
  username: string;
  password: string;
  name: string;
  code: string;
}): Promise<Result> {
  assertCoach();
  const server = serverOf(input.server);
  if (!server) return { ok: false, message: "Enter the server address, e.g. https://topset-yourname.vercel.app." };
  try {
    const session = await api<Session>(server, "register", { method: "POST", body: input });
    return await begin(server, session);
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/** A forgotten password: the admin's reset code and a new one, then signed in here. */
export async function resetPassword(input: { server: string; username: string; code: string; password: string }): Promise<Result> {
  assertCoach();
  const server = serverOf(input.server);
  if (!server) return { ok: false, message: "Enter the server address, e.g. https://topset-yourname.vercel.app." };
  try {
    const session = await api<Session>(server, "reset", { method: "POST", body: input });
    const result = await begin(server, session);
    // Recovered without the username: say which account it was.
    return result.ok && !input.username.trim()
      ? { ok: true, message: `Password set. Your username is ${usernameOf(session.coach)}.` }
      : result;
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/** How many computers are signed in to this account, this one included. */
export async function signedInComputers(): Promise<{ sessions?: number; error?: string }> {
  assertCoach();
  try {
    const { sessions } = await admin<{ sessions: number }>("account");
    return { sessions };
  } catch (error) {
    return { error: message(error) };
  }
}

/** A new password, given the current one. Every other computer is signed out. */
export async function changePassword(current: string, next: string): Promise<Result> {
  assertCoach();
  try {
    await admin("account", { method: "POST", body: { action: "password", current, next } });
    return { ok: true, message: "Password changed. Any other computer has to sign in again." };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/** Ends every sign-in to this account but this computer's. */
export async function signOutOtherComputers(): Promise<Result> {
  assertCoach();
  try {
    const { signedOut } = await admin<{ signedOut: number }>("account", { method: "POST", body: { action: "sign-out-others" } });
    return { ok: true, message: signedOut === 1 ? "Signed out 1 other computer." : `Signed out ${signedOut} other computers.` };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/**
 * Deletes this coach's account on the server, and everything in it. This computer is
 * signed out; its own copy of the data stays here, working as before.
 */
export async function deleteMyAccount(password: string): Promise<Result> {
  assertCoach();
  try {
    await admin("account", { method: "POST", body: { action: "delete", password } });
  } catch (error) {
    return { ok: false, message: message(error) };
  }
  stopSync();
  writeConfig(null);
  revalidatePath("/", "layout");
  return { ok: true, message: "Your account is deleted. Everything on this computer is still here." };
}

/** Signs this computer out. Its data stays here; it just stops syncing. */
export async function signOut(): Promise<Result> {
  assertCoach();
  const config = readConfig();
  stopSync();
  if (config) {
    await api(config.server, "logout", { method: "POST", token: config.token }).catch(() => undefined);
  }
  writeConfig(null);
  revalidatePath("/", "layout");
  return { ok: true, message: "Signed out. Your data stays on this computer." };
}

/** Makes the server match this computer now, rather than waiting for the next change. */
export async function syncEverything(): Promise<Result> {
  assertCoach();
  if (!readConfig()) return { ok: false, message: "Sign in first." };
  resetSync();
  const { error } = await syncNow();
  return error ? { ok: false, message: error } : { ok: true, message: "Everything is synced." };
}

export type CoachListing = { id: string; name: string; username: string; isAdmin: boolean; disabled: boolean; athletes: number };
export type InviteListing = { code: string; note: string | null; expiresAt: string };

async function admin<T>(route: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const config = readConfig();
  if (!config) throw new Error("Sign in first.");
  return api<T>(config.server, route, { ...init, token: config.token });
}

export async function listCoaches(): Promise<{ coaches: CoachListing[]; invites: InviteListing[]; error?: string }> {
  assertCoach();
  try {
    const [{ coaches }, { invites }] = await Promise.all([
      admin<{ coaches: CoachListing[] }>("coaches"),
      admin<{ invites: InviteListing[] }>("invites"),
    ]);
    return { coaches, invites };
  } catch (error) {
    return { coaches: [], invites: [], error: message(error) };
  }
}

export async function createInvite(note: string): Promise<{ invite?: InviteListing; error?: string }> {
  assertCoach();
  try {
    const { invite } = await admin<{ invite: InviteListing }>("invites", { method: "POST", body: { note } });
    return { invite };
  } catch (error) {
    return { error: message(error) };
  }
}

/** For the admin: withdraws an invite code nobody has used yet. */
export async function deleteInvite(code: string): Promise<{ error?: string }> {
  assertCoach();
  try {
    await admin(`invites?code=${encodeURIComponent(code)}`, { method: "DELETE" });
    return {};
  } catch (error) {
    return { error: message(error) };
  }
}

/**
 * For the admin: turn a coach's account off (every sign-in ends, their athletes' links
 * stop, nothing is deleted) or back on, or make them a one-time password reset code.
 */
export async function manageCoach(
  id: string,
  action: "revoke" | "restore" | "reset" | "delete",
): Promise<{ code?: string; expiresAt?: string; error?: string }> {
  assertCoach();
  try {
    const { code, expiresAt } = await admin<{ code?: string; expiresAt?: string }>(`coaches/${encodeURIComponent(id)}`, {
      method: "POST",
      body: { action },
    });
    return { code, expiresAt };
  } catch (error) {
    return { error: message(error) };
  }
}
