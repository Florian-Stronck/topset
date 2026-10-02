"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useCommands, type Command } from "@/lib/commands";
import type { WeekCell } from "@/lib/overview";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/dates";
import { Trophy } from "@/components/CheckinIcon";

/** What kind of thing needs doing, for the counts across the top. */
export type IssueCategory = "review" | "program" | "training" | "wellness" | "weight" | "link";

/** Something the coach should do for an athlete, and the button that goes and does it. */
export type Issue = {
  key: string;
  text: string;
  category: IssueCategory;
  /** Today rather than this week. */
  urgent: boolean;
  fix: { label: string; href: string };
};

export type BoardRow = {
  id: string;
  name: string;
  unit: string;
  /** Tracking, at the phase and week the athlete is in. */
  href: string;
  running: boolean;
  /** Sets the athlete flagged as PRs in the last week. */
  prs: number;
  phase: {
    name: string;
    program: string;
    status: "upcoming" | "active" | "done";
    week: number;
    of: number;
    start: string;
  } | null;
  daysLeft: number | null;
  cells: WeekCell[];
  weekPct: number | null;
  pct28: number | null;
  bodyweight: { weight: number; change7: number | null; age: number | null; overClass: number | null } | null;
  meet: {
    name: string;
    days: number;
    weightClass: string | null;
    limit: number | null;
    /** Bodyweight on the day if the last three weeks' trend holds. */
    projected: number | null;
  } | null;
  /** The latest readiness score out of 5, and its day. */
  readiness: { score: number; day: string } | null;
  /** Active injuries, worst first. */
  injuries: { label: string; severity: number }[];
  issues: Issue[];
};

const CATEGORIES: { id: IssueCategory; label: string }[] = [
  { id: "review", label: "To review" },
  { id: "program", label: "Programs" },
  { id: "training", label: "Training" },
  { id: "wellness", label: "Wellness" },
  { id: "weight", label: "Weight" },
  { id: "link", label: "Check-in links" },
];

type Filter = "all" | "attention" | "running" | IssueCategory;

/** The roster only needs a search box once it no longer fits on a screen. */
const SEARCH_FROM = 9;

/** Most in need first: the urgent, then the most to do, then by name. */
function byNeed(a: BoardRow, b: BoardRow) {
  const urgent = (r: BoardRow) => r.issues.filter((i) => i.urgent).length;
  return urgent(b) - urgent(a) || b.issues.length - a.issues.length || a.name.localeCompare(b.name);
}

/**
 * Overview: every athlete at a glance, the ones who need something first. Across the top,
 * how many need each kind of thing — a click shows only those. Each athlete is one card:
 * their week day by day, how much got done, how they feel, what they weigh, what's
 * hurting and what's coming up, then each thing to fix with a button that goes there.
 * What athletes logged lately sits underneath (handed in, rendered on the server).
 */
export function OverviewBoard({
  rows,
  week,
  activity,
}: {
  rows: BoardRow[];
  week: { ymd: string; day: string; today: boolean }[];
  activity: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const board = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const commands = useMemo<Command[]>(
    () => [
      {
        id: "overview-running",
        group: "Overview",
        title: filter === "running" ? t("Show every athlete") : t("Show only athletes running today"),
        keywords: "filter today phase",
        run: () => setFilter((f) => (f === "running" ? "all" : "running")),
      },
      {
        id: "overview-attention",
        group: "Overview",
        title: t("Jump to needs attention"),
        keywords: "feed flags check-ins warnings fix",
        run: () => {
          setFilter("attention");
          board.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      },
      ...(rows.length >= SEARCH_FROM
        ? [
            {
              id: "overview-search",
              group: "Overview",
              title: t("Search athletes"),
              keywords: "find filter",
              run: () => {
                board.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                search.current?.focus();
              },
            },
          ]
        : []),
      // Each athlete's tracking, at the week they're in.
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
    [rows, filter, router],
  );
  useCommands("overview", commands);

  const needing = rows.filter((r) => r.issues.length > 0).length;
  const counts = new Map(CATEGORIES.map((c) => [c.id, rows.filter((r) => r.issues.some((i) => i.category === c.id)).length]));
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) =>
      filter === "all"
        ? true
        : filter === "attention"
          ? r.issues.length > 0
          : filter === "running"
            ? r.running
            : r.issues.some((i) => i.category === filter),
    )
    .filter((r) => q === "" || r.name.toLowerCase().includes(q) || (r.phase?.name.toLowerCase().includes(q) ?? false))
    .sort(byNeed);

  const pill = (id: Filter, label: string, n: number, tone: "warn" | "plain" = "plain") => (
    <button
      key={id}
      type="button"
      aria-pressed={filter === id}
      onClick={() => setFilter((f) => (f === id ? "all" : id))}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] ${
        filter === id ? "border-accent/60 bg-surface-2 text-foreground" : "border-border bg-surface text-muted hover:text-foreground"
      }`}
    >
      {label}
      <span className={`tabular-nums font-semibold ${tone === "warn" && n > 0 ? "text-warn" : n === 0 ? "text-muted-2" : "text-foreground"}`}>{n}</span>
    </button>
  );

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={filter === "attention"}
          onClick={() => setFilter((f) => (f === "attention" ? "all" : "attention"))}
          className={`flex items-baseline gap-2 rounded-xl border px-4 py-2 text-left ${
            filter === "attention" ? "border-accent/60 bg-surface-2" : "border-border bg-surface hover:bg-surface-2"
          }`}
        >
          <span className={`text-[22px] font-semibold tabular-nums ${needing > 0 ? "text-warn" : "text-ok"}`}>{needing}</span>
          <span className="text-[12px] text-muted">
            {needing === 0 ? t("all caught up") : t(needing === 1 ? "athlete needs you" : "athletes need you")}
            <span className="text-muted-2"> · {t("{n} on the roster", { n: rows.length })}</span>
          </span>
        </button>
        {CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => pill(c.id, t(c.label), counts.get(c.id) ?? 0, "warn"))}
        {pill("running", t("Running today"), rows.filter((r) => r.running).length)}
      </div>

      <section ref={board} className="mt-5 scroll-mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("ATHLETES")}</h2>
          <Legend />
          {rows.length >= SEARCH_FROM && (
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search athletes")}
              className="ml-auto w-56 rounded-full border border-border bg-surface px-3 py-1 text-[12px] outline-none placeholder:text-muted-2 focus:border-accent"
            />
          )}
        </div>

        <div className="mt-2 space-y-2">
          {shown.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-[12px] text-muted-2">
              {rows.length === 0 ? t("No athletes yet.") : filter === "all" ? t("No athlete matches.") : t("Nobody here — all caught up.")}
            </div>
          ) : (
            shown.map((row) => <AthleteCard key={row.id} row={row} week={week} />)
          )}
        </div>
      </section>

      {activity}
    </>
  );
}

function AthleteCard({ row, week }: { row: BoardRow; week: { ymd: string; day: string; today: boolean }[] }) {
  const urgent = row.issues.some((i) => i.urgent);
  // How much it needs you, as a dot by the name: red, amber, or green for all good.
  const dot = urgent ? "bg-miss" : row.issues.length > 0 ? "bg-warn" : "bg-ok";
  return (
    <article className="rounded-xl border border-border bg-surface">
      <div className="grid items-center gap-x-5 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(170px,1fr)_auto_64px_minmax(260px,1.6fr)]">
        <Link href={row.href} className="group flex min-w-0 items-center gap-2.5">
          <span
            aria-label={urgent ? t("Needs attention today") : row.issues.length > 0 ? t("Needs attention") : t("All good")}
            className={`size-2 shrink-0 rounded-full ${dot}`}
          />
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
            {row.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14px] font-semibold group-hover:text-accent">{row.name}</span>
              {row.prs > 0 && (
                <span
                  title={t("{n} PR this week", { n: row.prs })}
                  className="flex shrink-0 items-center gap-0.5 rounded bg-pr/15 px-1 py-px text-[10px] font-bold text-pr"
                >
                  <Trophy size={10} />
                  {row.prs > 1 ? row.prs : t("PR")}
                </span>
              )}
            </span>
            <span className="block truncate text-[11px] text-muted-2">
              {row.phase
                ? `${row.phase.program} · ${row.phase.name} · ${
                    row.phase.status === "active"
                      ? t("wk {n}/{of}", { n: row.phase.week, of: row.phase.of })
                      : row.phase.status === "upcoming"
                        ? t("starts {date}", { date: formatDate(row.phase.start) })
                        : t("finished")
                  }${row.daysLeft !== null ? ` · ${t("{n}d left", { n: Math.max(0, row.daysLeft) })}` : ""}`
                : t("No program")}
            </span>
          </span>
        </Link>

        <span className="grid grid-cols-7 gap-1" aria-label={t("This week")}>
          {row.cells.map((cell, i) => (
            <DayCell key={cell.ymd} cell={cell} day={week[i]} />
          ))}
        </span>

        <span className="text-right tabular-nums" title={t("Sets done this week, and over the last 4 weeks")}>
          <span className={`block text-[15px] font-semibold ${pctTone(row.weekPct)}`}>{row.weekPct === null ? "—" : `${row.weekPct}%`}</span>
          <span className="block text-[10px] text-muted-2">{row.pct28 === null ? "" : t("4 wk {n}%", { n: row.pct28 })}</span>
        </span>

        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chips row={row} />
        </span>
      </div>

      {row.issues.length > 0 && (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {row.issues.map((issue) => (
            <li key={issue.key} className="flex items-center gap-3 px-4 py-2">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${issue.urgent ? "bg-miss" : "bg-warn"}`} />
              <span className="min-w-0 flex-1 text-[13px]">{issue.text}</span>
              <Link
                href={issue.fix.href}
                className={`shrink-0 rounded-lg px-3 py-1 text-[12px] font-medium ${
                  issue.urgent ? "bg-accent text-white hover:opacity-90" : "border border-border text-foreground hover:border-accent hover:text-accent"
                }`}
              >
                {issue.fix.label} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** The athlete's state in a few words each: readiness, weight, injuries, what's next. */
function Chips({ row }: { row: BoardRow }) {
  const chip = (key: string, body: ReactNode, tone: "plain" | "warn" | "bad" | "ok" = "plain", title?: string) => (
    <span
      key={key}
      title={title}
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
        tone === "bad"
          ? "bg-miss/15 text-miss"
          : tone === "warn"
            ? "bg-warn/15 text-warn"
            : tone === "ok"
              ? "bg-ok/15 text-ok"
              : "bg-surface-3 text-muted"
      }`}
    >
      {body}
    </span>
  );
  const out: ReactNode[] = [];

  if (row.issues.length === 0) out.push(chip("good", `✓ ${t("All good")}`, "ok"));

  if (row.readiness) {
    out.push(
      chip(
        "ready",
        t("Readiness {n}/5", { n: row.readiness.score }),
        row.readiness.score <= 2.5 ? "warn" : "plain",
        t("Latest check-in, {date}", { date: formatDate(row.readiness.day) }),
      ),
    );
  }

  for (const injury of row.injuries.slice(0, 2)) {
    out.push(chip(`inj-${injury.label}`, `${injury.label} ${injury.severity}/5`, injury.severity >= 4 ? "bad" : "warn", t("Injury")));
  }
  if (row.injuries.length > 2) out.push(chip("inj-more", `+${row.injuries.length - 2}`, "warn"));

  if (row.bodyweight) {
    const over = row.bodyweight.overClass;
    out.push(
      chip(
        "bw",
        <>
          {row.bodyweight.weight} {row.unit}
          {row.bodyweight.change7 !== null && row.bodyweight.change7 !== 0 && (
            <span className="ml-1 opacity-70">
              {row.bodyweight.change7 > 0 ? "↑" : "↓"}
              {Math.abs(row.bodyweight.change7)}
            </span>
          )}
          {over !== null && over > 0 && <span className="ml-1">· {t("+{n} over", { n: over })}</span>}
        </>,
        over !== null && over > 0 ? "warn" : "plain",
        row.bodyweight.age !== null && row.bodyweight.age > 0 ? t("last weigh-in {n}d ago", { n: row.bodyweight.age }) : t("7-day avg"),
      ),
    );
  }

  if (row.meet) {
    const m = row.meet;
    out.push(
      chip(
        "meet",
        <>
          {t("Meet")} {m.days === 0 ? t("today") : t("in {n}d", { n: m.days })}
          {m.projected !== null && m.limit !== null && ` · → ${m.projected} ${row.unit}`}
        </>,
        m.projected !== null && m.limit !== null && m.projected > m.limit ? "warn" : m.days <= 14 ? "ok" : "plain",
        `${m.name}${m.weightClass ? ` · ${m.weightClass}` : ""}`,
      ),
    );
  }

  return <>{out}</>;
}

function pctTone(pct: number | null) {
  if (pct === null) return "text-muted-2";
  if (pct >= 90) return "text-ok";
  if (pct >= 70) return "text-foreground";
  return "text-warn";
}

const CELL: Record<WeekCell["status"], { cls: string; mark: string; label: string }> = {
  done: { cls: "bg-ok/80 text-black", mark: "✓", label: "Done" },
  partial: { cls: "bg-warn/25 text-warn ring-1 ring-inset ring-warn/60", mark: "½", label: "Partly done" },
  missed: { cls: "bg-miss/15 text-miss ring-1 ring-inset ring-miss/60", mark: "×", label: "Missed" },
  today: { cls: "ring-1 ring-inset ring-foreground/50 text-foreground", mark: "•", label: "Today" },
  upcoming: { cls: "bg-surface-3 text-muted-2", mark: "", label: "Upcoming" },
  rest: { cls: "text-muted-2/60", mark: "–", label: "Rest" },
  none: { cls: "", mark: "", label: "No program" },
};

function DayCell({ cell, day }: { cell: WeekCell; day?: { day: string; today: boolean } }) {
  const look = CELL[cell.status];
  const sets = cell.prescribed > 0 ? ` · ${t("{done}/{of} sets", { done: cell.done, of: cell.prescribed })}` : "";
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span className={`text-[9px] tracking-wider ${day?.today ? "font-semibold text-foreground" : "text-muted-2"}`}>
        {day?.day.slice(0, 2).toUpperCase()}
      </span>
      <span
        title={`${formatDate(cell.ymd)}${cell.label ? ` · ${cell.label}` : ""} · ${t(look.label)}${sets}`}
        className={`grid size-7 place-items-center rounded-md text-[12px] font-semibold ${look.cls}`}
      >
        {look.mark}
      </span>
    </span>
  );
}

function Legend() {
  const keys: WeekCell["status"][] = ["done", "partial", "missed", "today", "upcoming", "rest"];
  return (
    <span className="flex flex-wrap items-center gap-2.5 text-[10px] text-muted-2">
      {keys.map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span className={`grid size-3.5 place-items-center rounded-[3px] text-[9px] ${CELL[k].cls}`}>{CELL[k].mark}</span>
          {t(CELL[k].label)}
        </span>
      ))}
    </span>
  );
}
