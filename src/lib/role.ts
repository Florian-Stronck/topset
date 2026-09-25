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

/** First line of every coach action and route: nothing coach-only runs on the athlete host. */
export function assertCoach(): void {
  if (isAthleteHost()) throw new Error("Not available here.");
}
