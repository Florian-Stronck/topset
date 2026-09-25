"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useCommands, type Command } from "@/lib/commands";
import type { WeekCell } from "@/lib/overview";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/dates";
import { Trophy } from "@/components/CheckinIcon";

export type BoardRow = {
  id: string;
  name: string;
  unit: string;
  /** Tracking, at the phase and week the athlete is in. */
  href: string;
  running: boolean;
  flagged: boolean;
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
    /** Bodyweight on meet day if the last three weeks' trend holds. */
    projected: number | null;
  } | null;
};

/** The roster only needs a search box once it no longer fits on a screen. */
const SEARCH_FROM = 9;

const COLS = "minmax(140px,1.1fr) minmax(170px,1.4fr) 238px 84px 118px minmax(110px,0.9fr) 56px";

/**
 * The top of Overview: the stat tiles, the feed (handed in, rendered on the server) and
 * the week table — one row per athlete, this week day by day. The tiles steer the rest:
 * "Running today" filters the table, "Needs attention" jumps to the feed.
 */
export function OverviewBoard({
  rows,
  stats,
  week,
  feed,
}: {
  rows: BoardRow[];
  stats: { athletes: number; programs: number; phases: number };
  week: { ymd: string; day: string; today: boolean }[];
  feed: ReactNode;
}) {
  const [runningOnly, setRunningOnly] = useState(false);
  const [query, setQuery] = useState("");
  const table = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const commands = useMemo<Command[]>(
    () => [
      {
        id: "overview-running",
        group: "Overview",
        title: runningOnly ? t("Show every athlete") : t("Show only athletes running today"),
        keywords: "filter today phase",
        run: () => {
          setRunningOnly((on) => !on);
          table.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      },
      {
        id: "overview-attention",
        group: "Overview",
        title: t("Jump to needs attention"),
        keywords: "feed flags check-ins warnings",
        run: () => document.getElementById("feed")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      },
      ...(rows.length >= SEARCH_FROM
        ? [
            {
              id: "overview-search",
              group: "Overview",
              title: t("Search athletes"),
              keywords: "find filter",
              run: () => {
                table.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    [rows, runningOnly, router],
  );
  useCommands("overview", commands);

  const running = rows.filter((r) => r.running).length;
  const attention = rows.filter((r) => r.flagged).length;
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!runningOnly || r.running) &&
      (q === "" || r.name.toLowerCase().includes(q) || (r.phase?.name.toLowerCase().includes(q) ?? false)),
  );

  return (
    <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label={t("ATHLETES")} value={stats.athletes} href="/athletes" />
        <Stat label={t("PROGRAMS")} value={stats.programs} />
        <Stat label={t("PHASES")} value={stats.phases} />
        <Stat
          label={t("RUNNING TODAY")}
          value={running}
          active={runningOnly}
          title={runningOnly ? t("Show every athlete") : t("Show only athletes with a phase running today")}
          onClick={() => {
            setRunningOnly((on) => !on);
            table.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        <Stat label={t("NEEDS ATTENTION")} value={attention} tone={attention > 0 ? "warn" : "ok"} href="#feed" />
      </div>

      {feed}

      <section ref={table} className="mt-7 scroll-mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("THIS WEEK")}</h2>
          {runningOnly && (
            <button
              type="button"
              onClick={() => setRunningOnly(false)}
              className="rounded-full border border-accent/50 bg-surface-2 px-2.5 py-0.5 text-[11px] text-foreground"
            >
              {t("Running today")} ×
            </button>
          )}
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

        <div className="mt-2 overflow-x-auto rounded-xl border border-border">
          <div
            className="grid min-w-full w-fit items-center border-b border-border bg-surface-2 px-4 py-2 text-[10px] tracking-[0.14em] text-muted-2"
            style={{ gridTemplateColumns: COLS }}
          >
            <span>{t("ATHLETE")}</span>
            <span>{t("PHASE")}</span>
            <span className="grid grid-cols-7 gap-1 text-center">
              {week.map((d) => (
                <span key={d.ymd} className={d.today ? "font-semibold text-foreground" : ""}>
                  {d.day.slice(0, 2).toUpperCase()}
                </span>
              ))}
            </span>
            <span className="text-right">{t("DONE")}</span>
            <span className="text-right">{t("BODYWEIGHT")}</span>
            <span className="pl-4">{t("NEXT MEET")}</span>
            <span className="text-right">{t("LEFT")}</span>
          </div>

          {shown.length === 0 ? (
            <div className="bg-surface px-4 py-6 text-center text-[12px] text-muted-2">
              {rows.length === 0 ? t("No athletes yet.") : t("No athlete matches.")}
            </div>
          ) : (
            shown.map((row) => <Row key={row.id} row={row} />)
          )}
        </div>
      </section>
    </>
  );
}

function Row({ row }: { row: BoardRow }) {
  return (
    <Link
      href={row.href}
      className="grid min-w-full w-fit items-center border-b border-border/60 bg-surface px-4 py-2 last:border-b-0 hover:bg-surface-2"
      style={{ gridTemplateColumns: COLS }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {row.flagged && <span aria-label={t("Needs attention")} className="size-1.5 shrink-0 rounded-full bg-warn" />}
        <span className="truncate text-[13px] font-medium">{row.name}</span>
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

      <span className="min-w-0">
        {row.phase ? (
          <>
            <span className="block truncate text-[12px]">
              {row.phase.name}
              <span className="text-muted-2">
                {" · "}
                {row.phase.status === "active"
                  ? t("wk {n}/{of}", { n: row.phase.week, of: row.phase.of })
                  : row.phase.status === "upcoming"
                    ? t("starts {date}", { date: formatDate(row.phase.start) })
                    : t("finished")}
              </span>
            </span>
            <span className="block truncate text-[11px] text-muted-2">{row.phase.program}</span>
          </>
        ) : (
          <span className="text-[12px] text-muted-2">{t("No program")}</span>
        )}
      </span>

      <span className="grid grid-cols-7 gap-1">
        {row.cells.map((cell) => (
          <DayCell key={cell.ymd} cell={cell} />
        ))}
      </span>

      <span className="text-right tabular-nums">
        <span className={`block text-[13px] ${pctTone(row.weekPct)}`}>{row.weekPct === null ? "—" : `${row.weekPct}%`}</span>
        <span className="block text-[10px] text-muted-2" title={t("Sets done of those due over the last 4 weeks")}>
          {row.pct28 === null ? "" : t("4 wk {n}%", { n: row.pct28 })}
        </span>
      </span>

      <span className="text-right tabular-nums">
        {row.bodyweight ? (
          <>
            <span className="block text-[13px]">
              {row.bodyweight.weight} {row.unit}
              {row.bodyweight.change7 !== null && row.bodyweight.change7 !== 0 && (
                <span className="ml-1 text-[11px] text-muted-2">
                  {row.bodyweight.change7 > 0 ? "↑" : "↓"}
                  {Math.abs(row.bodyweight.change7)}
                </span>
              )}
            </span>
            <span className="block text-[10px] text-muted-2">
              {row.bodyweight.overClass !== null
                ? row.bodyweight.overClass > 0
                  ? <span className="text-warn">{t("+{n} over class", { n: row.bodyweight.overClass })}</span>
                  : t("{n} under class", { n: Math.abs(row.bodyweight.overClass) })
                : row.bodyweight.age !== null && row.bodyweight.age > 0
                  ? t("{n}d ago", { n: row.bodyweight.age })
                  : t("7-day avg")}
            </span>
          </>
        ) : (
          <span className="text-[12px] text-muted-2">—</span>
        )}
      </span>

      <span className="min-w-0 pl-4">
        {row.meet ? (
          <>
            <span className="block truncate text-[12px]">{row.meet.name}</span>
            <span className="block truncate text-[11px] text-muted-2">
              {row.meet.days === 0 ? t("today") : t("in {n} days", { n: row.meet.days })}
              {row.meet.weightClass ? ` · ${row.meet.weightClass}` : ""}
              {row.meet.projected !== null && (
                <span
                  className={row.meet.limit !== null && row.meet.projected > row.meet.limit ? "text-warn" : ""}
                  title={t("Bodyweight on meet day if the last three weeks' trend holds")}
                >
                  {" · → "}
                  {row.meet.projected} {row.unit}
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="text-[12px] text-muted-2">—</span>
        )}
      </span>

      <span className="text-right text-[12px] tabular-nums text-muted">
        {row.daysLeft === null ? "—" : t("{n}d", { n: Math.max(0, row.daysLeft) })}
      </span>
    </Link>
  );
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

function DayCell({ cell }: { cell: WeekCell }) {
  const look = CELL[cell.status];
  const sets = cell.prescribed > 0 ? ` · ${t("{done}/{of} sets", { done: cell.done, of: cell.prescribed })}` : "";
  return (
    <span
      title={`${formatDate(cell.ymd)}${cell.label ? ` · ${cell.label}` : ""} · ${t(look.label)}${sets}`}
      className={`grid h-7 place-items-center rounded-md text-[12px] font-semibold ${look.cls}`}
    >
      {look.mark}
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

function Stat({
  label,
  value,
  tone = "plain",
  href,
  onClick,
  active = false,
  title,
}: {
  label: string;
  value: number;
  tone?: "plain" | "warn" | "ok";
  href?: string;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const cls = `block rounded-xl border px-4 py-3 text-left ${
    active ? "border-accent/60 bg-surface-2" : "border-border bg-surface"
  } ${href || onClick ? "hover:border-accent/50 hover:bg-surface-2" : ""}`;
  const body = (
    <>
      <div className="text-[10px] tracking-[0.16em] text-muted-2">{label}</div>
      <div
        className={`mt-1 text-[24px] font-semibold ${
          tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : ""
        }`}
      >
        {value}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} title={title} className={cls}>
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} title={title} className={cls}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}
