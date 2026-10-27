"use server";

import { assertCoach } from "@/lib/role";
import { syncChat as chat, syncLight as light, syncNow as sync } from "@/lib/sync";

/** Refresh: bring what athletes logged down (and anything pending up) before the page reloads. */
export async function syncNow(): Promise<void> {
  assertCoach();
  await sync();
}

/** An open chat: whether anything new came down, so the page reloads only then. */
export async function syncChat(): Promise<boolean> {
  assertCoach();
  return chat();
}

/** The sync light in the sidebar. */
export async function syncLight(): Promise<{ enabled: boolean; pending: boolean; error: string | null }> {
  assertCoach();
  return light();
}
