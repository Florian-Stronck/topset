import { notFound } from "next/navigation";
import { cache } from "react";
import { loadSettings } from "@/lib/coach-settings";
import { phoneAthlete, phoneCoach } from "@/lib/phone-coach";

/**
 * The signed-in coach and the athlete a page is about, once per request: the athlete's
 * layout and its page both ask. Null when signed out (the coach layout shows the sign-in).
 */
export const athletePage = cache(async (athleteId: string) => {
  const coach = await phoneCoach();
  if (!coach) return null;
  const athlete = await phoneAthlete(coach.id, athleteId);
  if (!athlete) notFound();
  await loadSettings(coach.id);
  return { coach, athlete, unit: athlete.unit === "LB" ? "lb" : "kg" } as const;
});
