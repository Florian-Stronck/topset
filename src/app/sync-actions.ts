"use server";

import { assertCoach } from "@/lib/role";
import { syncNow as sync } from "@/lib/sync";

/** Refresh: bring what athletes logged down (and anything pending up) before the page reloads. */
export async function syncNow(): Promise<void> {
  assertCoach();
  await sync();
}
