"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { syncNow } from "@/app/sync-actions";
import { fresh, useCommands, type Command } from "@/lib/commands";
import { t } from "@/lib/i18n";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import { setTrackingPref, usePref } from "@/lib/prefs";

export type TrackingView = "review" | "progress" | "wellness";

export const VIEWS: { id: TrackingView; label: string; icon: string }[] = [
  { id: "review", label: "Review", icon: "M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" },
  { id: "progress", label: "Progress", icon: "M3 17l6-6 4 4 8-8M14 7h7v7" },
  { id: "wellness", label: "Wellness", icon: "M3 12h4l3-8 4 16 3-8h4" },
];

/** How often Tracking fetches what athletes logged while it is open and on screen. */
const AUTO_REFRESH_MS = 60_000;

/**
 * Tracking's frame, whichever view is open: the athlete and phase pickers, the three
 * views as tabs, and what can be done from any of them. Fetches new athlete logs on its
 * own every minute while the window is in front.
 */
export function TrackingShell({
  view,
  athlete,
  neighbours,
  programs,
  phases,
  block,
  programName,
  hasLink,
  unreviewed,
  children,
}: {
  view: TrackingView;
  athlete: { id: string; name: string };
  neighbours: { prev: { id: string; name: string } | null; next: { id: string; name: string } | null };
  programs: { id: string; name: string; firstPhaseId: string | null }[];
  phases: { id: string; phase: string }[];
  block: { id: string; programId: string } | null;
  programName: string;
  hasLink: boolean;
  /** Sessions of this phase waiting to be reviewed, for the Review tab's badge. */
  unreviewed: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [, startTransition] = useTransition();
  const autoSync = usePref("tracking").autoSync;
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    startTransition(async () => {
      await syncNow();
      router.refresh();
      setLastRefresh(Date.now());
    });
  }, [router]);

  // Every minute while the window is in front, and when it comes back to the front.
  useEffect(() => {
    if (!autoSync) return;
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    const onFocus = () => {
      if (lastRefresh === null || Date.now() - lastRefresh > 15_000) tick();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [autoSync, refresh, lastRefresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  /** The same page with some of its query changed, keeping the week and filters. */
  const href = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(search.toString());
      params.set("athlete", athlete.id);
      if (block) params.set("block", block.id);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) params.delete(k);
        else params.set(k, v);
      }
      if (params.get("view") === "review") params.delete("view");
      return `/tracking?${params.toString()}`;
    },
    [athlete.id, block, search],
  );

  const commands = useMemo<Command[]>(() => {
    const track = (blockId: string) => router.push(`/tracking?athlete=${athlete.id}&block=${blockId}${view === "review" ? "" : `&view=${view}`}`);
    const at = block ? phases.findIndex((p) => p.id === block.id) : -1;
    return [
      ...VIEWS.map(
        (v): Command => ({
          id: `view-${v.id}`,
          group: "Tracking view",
          title: t(v.label),
          keywords: "tracking tab view",
          kind: "place",
          run: () => router.push(href({ view: v.id })),
        }),
      ),
      {
        id: "refresh",
        group: "Sync",
        title: t("Refresh what athletes logged"),
        keywords: "reload sync sets phone",
        run: refresh,
      },
      {
        id: "track-autosync",
        group: "Tracking view",
        title: autoSync ? t("Stop refreshing on its own") : t("Refresh on its own every minute"),
        keywords: "auto sync reload",
        run: () => setTrackingPref({ autoSync: !autoSync }),
      },
      {
        id: "track-link",
        group: "Tracking",
        title: t("Check-in link for {name}", { name: athlete.name }),
        keywords: "qr phone share athlete app",
        run: () => router.push(fresh(`/athletes?link=${athlete.id}`)),
      },
      {
        id: "phase-prev",
        group: "Phase",
        title: t("Previous phase"),
        run: () => {
          if (at > 0) track(phases[at - 1].id);
        },
      },
      {
        id: "phase-next",
        group: "Phase",
        title: t("Next phase"),
        run: () => {
          if (at >= 0 && at < phases.length - 1) track(phases[at + 1].id);
        },
      },
      ...phases
        .filter((p) => p.id !== block?.id)
        .map((p): Command => ({
          id: `open-phase-${p.id}`,
          group: "Phase",
          title: t("Track phase {name}", { name: p.phase }),
          kind: "place",
          run: () => track(p.id),
        })),
      ...programs
        .filter((p) => p.id !== block?.programId && p.firstPhaseId)
        .map((p): Command => ({
          id: `open-program-${p.id}`,
          group: "Program",
          title: t("Track {name}", { name: p.name }),
          kind: "place",
          run: () => track(p.firstPhaseId!),
        })),
      ...(block
        ? [
            {
              id: "go-programming",
              group: "Go",
              title: t("Programming for this phase"),
              kind: "place" as const,
              run: () => router.push(`/programming?athlete=${athlete.id}&phase=${block.id}`),
            },
          ]
        : []),
    ];
  }, [athlete, autoSync, block, href, phases, programs, refresh, router, view]);
  // Above the sidebar's: "Programming" here opens this very phase.
  useCommands("tracking", commands, 1);

  const ago = lastRefresh === null ? null : Math.floor((now - lastRefresh) / 60_000);

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div style={{ maxWidth: SHELL_MAX_WIDTH }} className="mx-auto w-full px-6 py-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{t("Tracking")}</h1>
            <div className="mt-1 flex items-center gap-1">
              <AthleteStep to={neighbours.prev} dir="left" href={(id) => `/tracking?athlete=${id}${view === "review" ? "" : `&view=${view}`}`} />
              <span className="text-[13px] font-medium">{athlete.name}</span>
              <AthleteStep to={neighbours.next} dir="right" href={(id) => `/tracking?athlete=${id}${view === "review" ? "" : `&view=${view}`}`} />
              {programName && <span className="ml-1 text-[12px] text-muted">{programName}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              title={autoSync ? t("Refreshes on its own every minute. Click to refresh now.") : t("Load what the athlete logged since this page opened")}
              className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[11px] text-muted-2 hover:text-accent"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
              </svg>
              {ago === null ? (autoSync ? t("Refreshes every minute") : t("Refresh")) : ago < 1 ? t("Updated just now") : t("Updated {n} min ago", { n: ago })}
            </button>
            {programs.length > 0 && block && (
              <div className="flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
                <select
                  value={block.programId}
                  aria-label={t("Program")}
                  onChange={(e) => {
                    const next = programs.find((p) => p.id === e.target.value);
                    if (next?.firstPhaseId) router.push(href({ block: next.firstPhaseId, week: null }));
                  }}
                  className="cursor-pointer bg-transparent text-[12px] outline-none"
                >
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {phases.length > 0 && block && (
              <div className="flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
                <select
                  value={block.id}
                  aria-label={t("Phase")}
                  onChange={(e) => router.push(href({ block: e.target.value, week: null }))}
                  className="cursor-pointer bg-transparent text-[12px] outline-none"
                >
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.phase}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {block && (
              <Link
                href={`/programming?athlete=${athlete.id}&phase=${block.id}`}
                className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
              >
                {t("Programming")}
              </Link>
            )}
          </div>
        </div>

        <nav role="tablist" aria-label={t("Tracking view")} className="mt-5 flex gap-1 border-b border-border">
          {VIEWS.map((v) => {
            const on = v.id === view;
            return (
              <Link
                key={v.id}
                role="tab"
                aria-selected={on}
                href={href({ view: v.id })}
                scroll={false}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[13px] ${
                  on ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={v.icon} />
                </svg>
                {t(v.label)}
                {v.id === "review" && unreviewed > 0 && (
                  <span
                    title={t("Sessions to review in this phase")}
                    className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold tabular-nums text-accent"
                  >
                    {unreviewed}
                  </span>
                )}
              </Link>
            );
          })}
          {!hasLink && (
            <span className="ml-auto self-center pb-1 text-[11px] text-muted-2">{t("No check-in link yet — nothing will come in from the phone.")}</span>
          )}
        </nav>

        {children}
      </div>
    </main>
  );
}

/** Previous or next athlete on the roster, same screen. */
function AthleteStep({ to, dir, href }: { to: { id: string; name: string } | null; dir: "left" | "right"; href: (id: string) => string }) {
  const icon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
  if (!to) return <span className="grid size-6 place-items-center text-muted-2 opacity-30">{icon}</span>;
  const label = dir === "left" ? t("Previous athlete: {name}", { name: to.name }) : t("Next athlete: {name}", { name: to.name });
  return (
    <Link href={href(to.id)} title={label} aria-label={label} className="grid size-6 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-accent">
      {icon}
    </Link>
  );
}
