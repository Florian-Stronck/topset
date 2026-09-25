import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { isAthleteHost } from "@/lib/role";
import { DEFAULTS, parseSettings, setActiveSettings, setRequestSettings, type CoachSettings } from "@/lib/settings";

/** Once per request: an athlete page's layout and the page itself both load them. */
const coachSettings = cache((coachId: string) =>
  prisma.coach.findUnique({ where: { id: coachId }, select: { settings: true } }),
);

/**
 * A coach's settings, read fresh from the database and made the active ones for the
 * helpers that consult them. Every page and export route calls this before it computes
 * anything, so a change made in Settings applies from the next request on.
 *
 * The desktop app has one coach. The Topset server has many: an athlete page names the
 * athlete's coach, and those settings hold for that request only.
 */
export async function loadSettings(coachId?: string): Promise<CoachSettings> {
  let settings = DEFAULTS;
  if (coachId) {
    const coach = await coachSettings(coachId);
    if (coach) settings = parseSettings(coach.settings);
  } else if (!isAthleteHost()) {
    const coach = await prisma.coach.findFirst({ select: { settings: true } });
    if (coach) settings = parseSettings(coach.settings);
  }
  // On the server, only a page that names its coach sets them; the root layout, which
  // can't know whose page it wraps, must not overwrite them with the defaults.
  if (isAthleteHost()) {
    if (coachId) setRequestSettings(settings);
  } else setActiveSettings(settings);
  return settings;
}
