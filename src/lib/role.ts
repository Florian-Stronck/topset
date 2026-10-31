import { AsyncLocalStorage } from "node:async_hooks";

/** A server setting, read from `TOPSET_<name>`. */
export function serverEnv(name: "ROLE" | "ADMIN_SETUP_CODE"): string {
  return process.env[`TOPSET_${name}`] ?? "";
}

/**
 * Topset runs two ways from one codebase: the coach's desktop app, and the hosted athlete
 * app (TOPSET_ROLE=athlete) that only serves /a/*. The coach side has no login — it trusts
 * whoever sits at the computer — so on the athlete host every coach entry point refuses.
 *
 * A server on the shared Turso database is always the athlete host, even with the role
 * missing: a coach screen there would hand every coach's data to anyone with the address.
 * The desktop app never has a Turso URL.
 */
export function isAthleteHost(): boolean {
  return serverEnv("ROLE") === "athlete" || Boolean(process.env.TURSO_DATABASE_URL);
}

const vouched = new AsyncLocalStorage<true>();

/**
 * Runs desktop coach actions on the server for the coach's phone (`/a/coach`). Only for a
 * caller that has already checked the signed-in coach may make this very change: inside
 * `run`, and only there, `assertCoach` lets them through.
 */
export function asSignedInCoach<T>(run: () => Promise<T>): Promise<T> {
  return vouched.run(true, run);
}

/** First line of every coach action and route: nothing coach-only runs on the athlete host. */
export function assertCoach(): void {
  if (isAthleteHost() && !vouched.getStore()) throw new Error("Not available here.");
}
