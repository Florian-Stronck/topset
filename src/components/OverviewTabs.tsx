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
  { id: "athletes", label: "Athletes", icon: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" },
  { id: "schedule", label: "Schedule", icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" },
  { id: "chat", label: "Chat", icon: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" },
];

/** How often Schedule and Chat fetch what came in from phones while open and on screen. */
const AUTO_REFRESH_MS = 10_000;

/**
 * The Overview's three views as tabs: the roster board, and Schedule and Chat for every
 * athlete at once, badged with what waits on the coach.
 */
export function OverviewTabs({ tab, news }: { tab: OverviewTab; news: Record<OverviewTab, number> }) {
  const router = useRouter();
  const autoSync = usePref("tracking").autoSync;

  // Messages and moves come in from phones: fetch them like Tracking does.
  useEffect(() => {
    if (!autoSync || tab === "athletes") return;
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
            {news[v.id] > 0 && (
              <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold tabular-nums text-accent">{news[v.id]}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
