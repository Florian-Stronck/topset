/** The athlete hub's tabs: how training is going, their profile, and what their app asks. */
export type AthleteTab = "overview" | "profile" | "app";

export const ATHLETE_TABS: AthleteTab[] = ["overview", "profile", "app"];

export const athleteHref = (athleteId: string, tab: AthleteTab = "overview") =>
  tab === "overview" ? `/athletes?athlete=${athleteId}` : `/athletes?athlete=${athleteId}&tab=${tab}`;
