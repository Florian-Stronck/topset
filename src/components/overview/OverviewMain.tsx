"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { answerAthleteMeeting, markMovesSeen } from "@/app/tracking/actions";
import { InboxDetail, doneAction, KIND_LABEL } from "@/components/overview/InboxDetail";
import { inView, ROSTER_VIEWS, RosterTable, sortValue, type RosterSort, type RosterView } from "@/components/overview/RosterTable";
import { useCommands, type Command } from "@/lib/commands";
import { LOCALE, t } from "@/lib/i18n";
import { byUrgency, FILTER_OF, FOREVER, isSnoozed, liveSnoozes, type InboxFilter, type InboxItem } from "@/lib/inbox";
import { setPref, usePref } from "@/lib/prefs";
import type { RosterRow } from "@/lib/roster";
import { addDays } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sessions", label: "Sessions" },
  { id: "messages", label: "Messages" },
  { id: "schedule", label: "Schedule" },
  { id: "program", label: "Programs" },
  { id: "training", label: "Training" },
  { id: "wellness", label: "Wellness" },
  { id: "link", label: "Check-in links" },
  { id: "pr", label: "PRs" },
];

/** How long ago, short: minutes, hours, days, then the date without its year. */
function ago(at: string | null): string {
  if (!at) return "";
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (minutes < 60) return t("{n} min", { n: Math.max(1, minutes) });
  if (minutes < 24 * 60) return t("{n} h", { n: Math.round(minutes / 60) });
  if (minutes < 7 * 24 * 60) return t("{n}d ago", { n: Math.round(minutes / (24 * 60)) });
  return new Date(at).toLocaleDateString(LOCALE[activeSettings().language], { day: "numeric", month: "short" });
}

/**
 * The Overview: what needs the coach on top, as one queue across every athlete with the
 * picked item open beside it, and the whole roster underneath. A roster row's count opens
 * the queue on that athlete; the item open in the queue lights up its athlete's row.
 */
export function OverviewMain({ items, rows, today }: { items: InboxItem[]; rows: RosterRow[]; today: string }) {
  const router = useRouter();
  const snoozes = usePref("inboxSnoozed");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [athlete, setAthlete] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [showSnoozed, setShowSnoozed] = useState(false);
  // Hidden as soon as they're dealt with; the refresh that drops them follows.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [view, setView] = useState<RosterView>("all");
  const [grouped, setGrouped] = useState(true);
  const [sort, setSort] = useState<RosterSort>("needs");
  const [query, setQuery] = useState("");
  const [, start] = useTransition();
  const reply = useRef<HTMLTextAreaElement>(null);
  const queue = useRef<HTMLElement>(null);
  const roster = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const live = useMemo(() => items.filter((i) => !cleared.has(i.key)).sort(byUrgency), [items, cleared]);
  const open = live.filter((i) => !isSnoozed(snoozes, i.key, today));
  const snoozed = live.filter((i) => isSnoozed(snoozes, i.key, today));
  const pool = showSnoozed ? snoozed : open;
  const forAthlete = athlete ? pool.filter((i) => i.athleteId === athlete) : pool;
  const shown = filter === "all" ? forAthlete : forAthlete.filter((i) => FILTER_OF[i.kind] === filter);
  const current = shown.find((i) => i.key === picked) ?? shown[0] ?? null;
  const counts = new Map<InboxFilter, number>(FILTERS.map((f) => [f.id, f.id === "all" ? forAthlete.length : forAthlete.filter((i) => FILTER_OF[i.kind] === f.id).length]));

  // What each athlete has waiting, for the roster's last column and its dot.
  const needs = useMemo(() => {
    const out = new Map<string, { count: number; tone: "miss" | "warn" | "ok" }>();
    for (const i of open) {
      if (i.kind === "pr") continue;
      const had = out.get(i.athleteId) ?? { count: 0, tone: "warn" as const };
      out.set(i.athleteId, { count: had.count + 1, tone: had.tone === "miss" || i.urgent ? "miss" : "warn" });
    }
    return out;
  }, [open]);
  const needsOf = (id: string) => needs.get(id) ?? { count: 0, tone: "ok" as const };

  const step = (by: 1 | -1) => {
    if (shown.length === 0) return;
    const at = current ? shown.indexOf(current) : -1;
    setPicked(shown[Math.min(shown.length - 1, Math.max(0, at + by))].key);
  };
  /** Opens the item after this one, as it leaves the list. */
  const moveOn = (item: InboxItem) => {
    const at = shown.indexOf(item);
    setPicked(shown[at + 1]?.key ?? shown[at - 1]?.key ?? null);
  };
  /** Takes a dealt-with item off the queue. */
  const clear = (item: InboxItem) => {
    moveOn(item);
    setCleared((c) => new Set(c).add(item.key));
  };
  const snooze = (item: InboxItem, forever = false) => {
    moveOn(item);
    setPref("inboxSnoozed", { ...liveSnoozes(snoozes, today), [item.key]: forever ? FOREVER : addDays(today, 1) });
  };
  const unsnooze = (item: InboxItem) => {
    moveOn(item);
    const rest = { ...snoozes };
    delete rest[item.key];
    setPref("inboxSnoozed", rest);
  };
  const finish = (item: InboxItem) => {
    const done = doneAction(item);
    if (!done) return;
    clear(item);
    start(async () => {
      await done();
      router.refresh();
    });
  };
  const focusAthlete = (id: string) => {
    setAthlete(id);
    setFilter("all");
    setShowSnoozed(false);
    setPicked(null);
    queue.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const q = query.trim().toLowerCase();
  const visible = rows
    .filter((r) => inView(r, view, needsOf(r.id).count))
    .filter((r) => q === "" || r.name.toLowerCase().includes(q) || (r.phase?.name.toLowerCase().includes(q) ?? false))
    .sort((a, b) => {
      const x = sortValue(a, sort, needsOf(a.id).count);
      const y = sortValue(b, sort, needsOf(b.id).count);
      const urgent = Number(needsOf(b.id).tone === "miss") - Number(needsOf(a.id).tone === "miss");
      if (sort === "needs" && urgent !== 0) return urgent;
      return typeof x === "string" ? x.localeCompare(y as string) : (y as number) - x || a.name.localeCompare(b.name);
    });
  const groups = grouped
    ? [...new Set(visible.map((r) => r.phase?.name ?? ""))].map((name) => ({ title: name || t("No program"), rows: visible.filter((r) => (r.phase?.name ?? "") === name) }))
    : [{ title: null, rows: visible }];

  const commands = useMemo<Command[]>(
    () => [
      { id: "inbox-next", group: "Overview", title: t("Next in the inbox"), keywords: "queue down j", run: () => step(1) },
      { id: "inbox-prev", group: "Overview", title: t("Previous in the inbox"), keywords: "queue up k", run: () => step(-1) },
      ...(current && doneAction(current)
        ? [{ id: "inbox-done", group: "Overview", title: t("Done: mark reviewed, read or seen"), keywords: "inbox clear e", run: () => finish(current) }]
        : []),
      ...(current
        ? [
            { id: "inbox-snooze", group: "Overview", title: t("Snooze till tomorrow"), keywords: "inbox later s", run: () => snooze(current) },
            { id: "inbox-open", group: "Overview", title: t("Open where it gets fixed"), keywords: "inbox go o", run: () => router.push(current.href) },
          ]
        : []),
      ...(current && (current.kind === "session" || current.kind === "message")
        ? [{ id: "inbox-reply", group: "Overview", title: t("Reply / write a note"), keywords: "inbox comment feedback r", run: () => reply.current?.focus() }]
        : []),
      {
        id: "inbox-snoozed",
        group: "Overview",
        title: showSnoozed ? t("Show the inbox") : t("Show snoozed items"),
        keywords: "inbox later hidden",
        run: () => setShowSnoozed((s) => !s),
      },
      ...(athlete ? [{ id: "inbox-everyone", group: "Overview", title: t("Inbox: show every athlete"), run: () => setAthlete(null) }] : []),
      ...ROSTER_VIEWS.map((v) => ({
        id: `roster-view-${v.id}`,
        group: "Overview",
        title: t("Roster: {view}", { view: t(v.label) }),
        keywords: "roster filter view",
        run: () => {
          setView(v.id);
          roster.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      })),
      {
        id: "roster-group",
        group: "Overview",
        title: grouped ? t("Roster: don't group by phase") : t("Roster: group by phase"),
        keywords: "roster group phase",
        run: () => setGrouped((g) => !g),
      },
      {
        id: "overview-search",
        group: "Overview",
        title: t("Search athletes"),
        keywords: "find filter roster",
        run: () => {
          roster.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          search.current?.focus();
        },
      },
      ...rows.map(
        (r): Command => ({
          id: `overview-track-${r.id}`,
          group: "Athlete",
          title: r.phase
            ? t("Tracking for {name} · {phase} week {n}", { name: r.name, phase: r.phase.name, n: r.phase.week })
            : t("Tracking for {name}", { name: r.name }),
          kind: "athlete",
          run: () => router.push(r.href),
        }),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, current, shown, showSnoozed, athlete, grouped, snoozes, router],
  );
  useCommands("overview", commands);

  const urgent = open.filter((i) => i.urgent).length;
  const athleteName = athlete ? rows.find((r) => r.id === athlete)?.name : null;

  return (
    <>
      <section ref={queue} data-tour="inbox" aria-label={t("Needs you")} className="mt-5 scroll-mt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className={`text-[26px] font-semibold tabular-nums ${open.length === 0 ? "text-ok" : urgent > 0 ? "text-miss" : "text-warn"}`}>{open.length}</span>
            <span className="text-[13px] text-muted">
              {open.length === 0 ? t("all caught up") : t(open.length === 1 ? "thing needs you" : "things need you")}
              {urgent > 0 && <span className="text-miss"> · {t("{n} today", { n: urgent })}</span>}
              {snoozed.length > 0 && <span className="text-muted-2"> · {t("{n} snoozed", { n: snoozed.length })}</span>}
            </span>
          </div>
          {athleteName && (
            <button
              type="button"
              onClick={() => setAthlete(null)}
              className="flex items-center gap-1.5 rounded-full border border-accent/60 bg-surface-2 px-3 py-1 text-[12px]"
            >
              {athleteName}
              <span aria-label={t("Show every athlete")} className="text-muted">
                ×
              </span>
            </button>
          )}
          <div role="toolbar" aria-label={t("Filter")} className="ml-auto flex flex-wrap gap-1.5">
            {FILTERS.filter((f) => f.id === "all" || (counts.get(f.id) ?? 0) > 0).map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] ${
                  filter === f.id ? "border-accent/60 bg-surface-2 text-foreground" : "border-border bg-surface text-muted hover:text-foreground"
                }`}
              >
                {t(f.label)}
                <span className="font-semibold tabular-nums text-foreground">{counts.get(f.id)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(320px,1fr)_minmax(0,1.5fr)]">
          <div className="flex max-h-[520px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
            <ul aria-label={t("Queue")} className="min-h-0 flex-1 divide-y divide-border/60 overflow-auto">
              {shown.length === 0 && (
                <li className="px-4 py-8 text-center text-[12px] text-muted-2">
                  {showSnoozed ? t("Nothing snoozed.") : t("Nothing here — all caught up.")}
                </li>
              )}
              {shown.map((item) => {
                const on = item === current;
                return (
                  <li key={item.key}>
                    <div
                      className={`flex cursor-pointer gap-2.5 px-3.5 py-2.5 ${on ? "bg-surface-3" : "hover:bg-surface-2"} ${showSnoozed ? "opacity-70" : ""}`}
                      onClick={() => setPicked(item.key)}
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${item.urgent ? "bg-miss" : item.kind === "pr" ? "bg-pr" : "bg-warn"}`}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-baseline gap-2">
                          <button type="button" aria-current={on || undefined} onClick={() => setPicked(item.key)} className="truncate text-left text-[13px] font-semibold">
                            {item.athlete}
                          </button>
                          <span className="shrink-0 text-[9.5px] tracking-[0.14em] text-muted-2">{t(KIND_LABEL[item.kind])}</span>
                          <span suppressHydrationWarning className="ml-auto shrink-0 text-[11px] text-muted-2">
                            {ago(item.at)}
                          </span>
                        </span>
                        <span className={`line-clamp-2 text-[12.5px] leading-snug ${on ? "text-foreground" : "text-muted"}`}>{item.text}</span>
                        {showSnoozed ? (
                          <span className="mt-1 flex">
                            <button type="button" onClick={() => unsnooze(item)} className="rounded-md border border-border px-2.5 py-0.5 text-[11.5px] hover:border-accent hover:text-accent">
                              {t("Bring back")}
                            </button>
                          </span>
                        ) : item.kind === "meeting" && item.meetingId ? (
                          <span className="mt-1 flex gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                clear(item);
                                start(() => answerAthleteMeeting(item.meetingId!, true).then(() => router.refresh()));
                              }}
                              className="rounded-md bg-accent px-2.5 py-0.5 text-[11.5px] font-medium text-white hover:opacity-90"
                            >
                              {t("Accept")}
                            </button>
                          </span>
                        ) : item.kind === "move" && item.moveId ? (
                          <span className="mt-1 flex gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                clear(item);
                                start(() => markMovesSeen(item.athleteId, [item.moveId!]).then(() => router.refresh()));
                              }}
                              className="rounded-md border border-border px-2.5 py-0.5 text-[11.5px] hover:border-accent hover:text-accent"
                            >
                              {t("Got it")}
                            </button>
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-border px-3.5 py-2 text-[11.5px] text-muted">
              <button type="button" onClick={() => setShowSnoozed((s) => !s)} className="hover:text-foreground">
                {showSnoozed ? `← ${t("Back to the inbox")}` : t("Snoozed · {n}", { n: snoozed.length })}
              </button>
              <span className="text-muted-2">
                <kbd className="font-mono">J</kbd>/<kbd className="font-mono">K</kbd> {t("move")} · <kbd className="font-mono">E</kbd> {t("done")} ·{" "}
                <kbd className="font-mono">S</kbd> {t("snooze")} · <kbd className="font-mono">R</kbd> {t("reply")}
              </span>
            </div>
          </div>

          {current ? (
            <InboxDetail
              key={current.key}
              item={current}
              replyRef={reply}
              onCleared={() => clear(current)}
              onSnooze={(forever) => (showSnoozed ? unsnooze(current) : snooze(current, forever))}
            />
          ) : (
            <div className="grid place-items-center rounded-xl border border-dashed border-border px-4 py-10 text-[12px] text-muted-2">
              {t("Pick something from the queue.")}
            </div>
          )}
        </div>
      </section>

      <section aria-label={t("Roster")} className="mt-8 scroll-mt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-[11px] tracking-[0.16em] text-muted-2">{t("ROSTER")}</h2>
          <div role="tablist" aria-label={t("Views")} className="flex flex-wrap gap-1">
            {ROSTER_VIEWS.map((v) => {
              const n = rows.filter((r) => inView(r, v.id, needsOf(r.id).count)).length;
              if (v.id !== "all" && n === 0) return null;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`rounded-lg px-2.5 py-1 text-[12px] ${view === v.id ? "bg-surface-3 text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  {t(v.label)} <span className="ml-0.5 tabular-nums text-muted-2">{n}</span>
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search athletes")}
            aria-label={t("Search athletes")}
            className="w-48 rounded-full border border-border bg-surface px-3 py-1 text-[12px] outline-none placeholder:text-muted-2 focus:border-accent"
          />
          <button
            type="button"
            aria-pressed={grouped}
            onClick={() => setGrouped((g) => !g)}
            className={`rounded-lg border px-2.5 py-1 text-[12px] ${grouped ? "border-accent/60 bg-surface-2 text-foreground" : "border-border bg-surface text-muted hover:text-foreground"}`}
          >
            {t("Group by phase")}
          </button>
        </div>
        {visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-[12px] text-muted-2">
            {rows.length === 0 ? t("No athletes yet.") : t("No athlete matches.")}
          </div>
        ) : (
          <RosterTable
            ref={roster}
            groups={groups}
            needs={needsOf}
            picked={current?.athleteId ?? null}
            onNeeds={focusAthlete}
            sort={sort}
            onSort={setSort}
            average={visible}
          />
        )}
        <p className="mt-2 text-[11px] text-muted-2">{t("e1RM: the best estimate of the last 4 weeks, and its change on the 4 weeks before. Lines run over the last 8 weeks.")}</p>
      </section>
    </>
  );
}
