/**
 * Runs once as the server starts. A desktop app signed in to a Topset server starts its
 * background sync here. It does not wait: offline, the app still opens and sync catches
 * up later.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TOPSET_CLOUD_FILE) return;
  const { startSync } = await import("@/lib/sync");
  startSync();
}
