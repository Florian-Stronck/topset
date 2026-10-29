/**
 * The Overview's views: the inbox and roster, today across the roster, the season ahead,
 * insights, and Schedule and Chat for every athlete.
 */
export type OverviewTab = "athletes" | "today" | "season" | "insights" | "schedule" | "chat";

export const OVERVIEW_TABS: OverviewTab[] = ["athletes", "today", "season", "insights", "schedule", "chat"];

export const overviewHref = (tab: OverviewTab, athleteId?: string) =>
  tab === "athletes" ? "/overview" : `/overview?tab=${tab}${athleteId ? `&athlete=${athleteId}` : ""}`;
