"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { syncNow } from "@/app/sync-actions";
import { useCommands, type Command } from "@/lib/commands";
import { t } from "@/lib/i18n";
import { overviewHref, type OverviewTab } from "@/lib/overview-tabs";
import { usePref } from "@/lib/prefs";

const TABS: { id: OverviewTab; label: string; icon: string }[] = [
  { id: "athletes", label: "Overview", icon: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" },
  { id: "today", label: "Today", icon: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" },
  { id: "season", label: "Season", icon: "M3 3v18h18M8 7h10M6 12h8M11 17h8" },
  { id: "insights", label: "Insights", icon: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6" },
  { id: "schedule", label: "Schedule", icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" },
  { id: "chat", label: "Chat", icon: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" },
];

/** How often the live views fetch what came in from phones while open and on screen. */
const AUTO_REFRESH_MS = 10_000;

/**
 * The Overview's views as tabs: the inbox and roster, Today, Season, Insights, and Schedule
 * and Chat for every athlete at once, badged with what waits on the coach.
 */
export function OverviewTabs({ tab, news }: { tab: OverviewTab; news: Partial<Record<OverviewTab, number>> }) {
  const router = useRouter();
  const autoSync = usePref("tracking").autoSync;

  // Messages and moves come in from phones: fetch them like Tracking does.
  useEffect(() => {
    // Season and Insights look at weeks, not minutes.
    if (!autoSync || tab === "season" || tab === "insights") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void syncNow().then(() => router.refresh());
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoSync, router, tab]);

  const commands = useMemo<Command[]>(
    () =>
      TABS.map((v) => ({
        id: `overview-tab-${v.id}`,
        group: "Overview",
        title: t(v.label),
        keywords: "overview tab view",
        kind: "place" as const,
        run: () => router.push(overviewHref(v.id)),
      })),
    [router],
  );
  useCommands("overview-tabs", commands);

  return (
    <nav role="tablist" aria-label={t("Overview")} className="mt-5 flex gap-1 border-b border-border">
      {TABS.map((v) => {
        const on = v.id === tab;
        return (
          <Link
            key={v.id}
            role="tab"
            aria-selected={on}
            href={overviewHref(v.id)}
            scroll={false}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[13px] ${
              on ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={v.icon} />
            </svg>
            {t(v.label)}
            {(news[v.id] ?? 0) > 0 && (
              <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold tabular-nums text-accent">{news[v.id]}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
