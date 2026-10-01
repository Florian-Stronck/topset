/**
 * The oldest desktop app the server still syncs with. Raise it in the release that makes
 * older copies unsafe to sync (a changed table they would write wrong); they are then told
 * to update instead. Copies from before the version was sent count as 0.0.0.
 */
// 0.5.0: older copies delete, on starting, whatever another computer added to the server.
export const MIN_DESKTOP_VERSION = "0.5.0";

export const VERSION_HEADER = "X-Topset-Version";

function parts(version: string): number[] {
  return version.split(".").map((p) => parseInt(p, 10) || 0);
}

/** Whether `version` (like "0.5.1") is older than `min`. */
export function olderThan(version: string, min: string): boolean {
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** Why the server won't sync with this request's desktop app, or null. */
export function tooOld(request: Request, min = MIN_DESKTOP_VERSION): string | null {
  const version = request.headers.get(VERSION_HEADER) ?? "0.0.0";
  return olderThan(version, min) ? `This Topset (${version}) is too old for the server. Update to ${min} or later.` : null;
}

/**
 * The first desktop app that knows about teams. Older ones keep syncing, but only see and
 * get the coach's own athletes: a teammate's would arrive without the coach they belong to.
 */
export const TEAMS_VERSION = "0.6.0";

/** Whether this request's desktop app can take athletes shared through a team. */
export function knowsTeams(request: Request): boolean {
  return !olderThan(request.headers.get(VERSION_HEADER) ?? "0.0.0", TEAMS_VERSION);
}
