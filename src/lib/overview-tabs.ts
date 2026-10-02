/** The Overview's views: the roster board, and Schedule and Chat for every athlete. */
export type OverviewTab = "athletes" | "schedule" | "chat";

export const overviewHref = (tab: OverviewTab, athleteId?: string) =>
  tab === "athletes" ? "/overview" : `/overview?tab=${tab}${athleteId ? `&athlete=${athleteId}` : ""}`;
