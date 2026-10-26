/**
 * Runs once as the server starts. A desktop app signed in to a Topset server starts its
 * background sync here. It does not wait: the desktop shell holds its splash until told the
 * first sync is through (or gives up waiting), so the first page shows what athletes logged
 * while the app was closed. Offline, the app still opens and sync catches up later.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TOPSET_CLOUD_FILE) return;
  const { startSync } = await import("@/lib/sync");
  void startSync().finally(() => process.send?.("synced"));
}
