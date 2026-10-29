"use client";

import Link from "next/link";
import { forwardRef, type ReactNode } from "react";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { latest, type RosterRow } from "@/lib/roster";

/** The saved views across the top of the roster. */
export type RosterView = "all" | "needs" | "training" | "meets" | "unplanned";
export const ROSTER_VIEWS: { id: RosterView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you" },
  { id: "training", label: "Training today" },
  { id: "meets", label: "Meet within 8 weeks" },
  { id: "unplanned", label: "No program" },
];

export function inView(row: RosterRow, view: RosterView, needs: number): boolean {
  if (view === "needs") return needs > 0;
  if (view === "training") return row.training;
  if (view === "meets") return row.meet !== null && row.meet.days <= 56;
  if (view === "unplanned") return row.phase === null || row.phase.status === "done";
  return true;
}

export type RosterSort = "needs" | "name" | "week" | "rpe" | "readiness" | "squat" | "bench" | "dead" | "meet";

const COLS = "grid grid-cols-[minmax(170px,1.6fr)_112px_52px_104px_104px_84px_84px_84px_108px_60px_56px] items-center gap-x-2.5";

/** A week-by-week line; a week without data leaves a gap. Values run from `lo` to `hi`. */
function Spark({ values, lo, hi, tone, zero = false }: { values: (number | null)[]; lo: number; hi: number; tone: string; zero?: boolean }) {
  const w = 52;
  const h = 20;
  const x = (i: number) => 2 + (i * (w - 4)) / Math.max(1, values.length - 1);
  const y = (v: number) => h - 2 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - 4);
  const runs: string[] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
    } else run.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(" "));
  return (
    <svg width={w} height={h} aria-hidden className={`shrink-0 ${tone}`}>
      {zero && <line x1={2} x2={w - 2} y1={y(0)} y2={y(0)} className="stroke-border" strokeDasharray="2 3" />}
      {runs.map((points, i) =>
        points.includes(" ") ? (
          <polyline key={i} points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <circle key={i} cx={points.split(",")[0]} cy={points.split(",")[1]} r={1.5} fill="currentColor" />
        ),
      )}
    </svg>
  );
}

const doneTone = (p: number | null) => (p === null ? "bg-surface-3" : p >= 90 ? "bg-ok" : p >= 75 ? "bg-ok/45" : p >= 50 ? "bg-warn" : "bg-miss");
const driftTone = (d: number | null) => (d === null ? "text-muted-2" : Math.abs(d) >= 1 ? "text-miss" : Math.abs(d) >= 0.5 ? "text-warn" : "text-muted");
const readyTone = (r: number | null) => (r === null ? "text-muted-2" : r <= 2.5 ? "text-miss" : r < 3.5 ? "text-warn" : "text-muted");
const pctTone = (p: number | null) => (p === null ? "text-muted-2" : p >= 90 ? "text-ok" : p >= 70 ? "text-foreground" : "text-warn");
const changeTone = (c: number | null) => (c === null ? "text-muted-2" : c >= 0.5 ? "text-ok" : c < 0 ? "text-miss" : "text-warn");
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** What sorting by a column compares; bigger first, except names and meets. */
export function sortValue(row: RosterRow, sort: RosterSort, needs: number): number | string {
  switch (sort) {
    case "needs":
      return needs;
    case "name":
      return row.name;
    case "week":
      return row.weekPct ?? -1;
    case "rpe":
      return Math.abs(latest(row.rpe) ?? 0);
    case "readiness":
      return -(latest(row.readiness) ?? 6);
    case "meet":
      return -(row.meet?.days ?? 9999);
    default:
      return row.lifts[sort].change ?? -999;
  }
}

/**
 * Every athlete as one row: six weeks of sets done, RPE against the plan and readiness over
 * eight, the main lifts' estimated maxes and where they're heading, bodyweight against the
 * next meet's class, and how many things wait in the inbox for them.
 */
export const RosterTable = forwardRef<
  HTMLDivElement,
  {
    groups: { title: string | null; rows: RosterRow[] }[];
    needs: (id: string) => { count: number; tone: "miss" | "warn" | "ok" };
    picked: string | null;
    onNeeds: (id: string) => void;
    sort: RosterSort;
    onSort: (sort: RosterSort) => void;
    average: RosterRow[];
  }
>(function RosterTable({ groups, needs, picked, onNeeds, sort, onSort, average }, ref) {
  const head = (label: string, by: RosterSort | null, right = false): ReactNode =>
    by ? (
      <button
        type="button"
        onClick={() => onSort(by)}
        aria-pressed={sort === by}
        className={`truncate text-[10px] tracking-[0.12em] hover:text-foreground ${right ? "text-right" : "text-left"} ${sort === by ? "text-foreground" : ""}`}
      >
        {label}
        {sort === by && " ▾"}
      </button>
    ) : (
      <span className={`truncate ${right ? "text-right" : ""}`}>{label}</span>
    );

  const mean = (values: (number | null)[]) => {
    const v = values.filter((x): x is number => x !== null);
    return v.length === 0 ? null : Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
  };

  return (
    <div ref={ref} className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div role="table" aria-label={t("Roster")} className="min-w-[1100px]">
        <div role="row" className={`${COLS} border-b border-border bg-surface-2 px-4 py-2 text-[10px] tracking-[0.12em] text-muted-2`}>
          {head(t("ATHLETE"), "name")}
          {head(t("6 WEEKS DONE"), null)}
          {head(t("WEEK"), "week", true)}
          {head(t("RPE VS PLAN"), "rpe")}
          {head(t("READINESS"), "readiness")}
          {head(t("SQUAT e1RM"), "squat", true)}
          {head(t("BENCH e1RM"), "bench", true)}
          {head(t("DEAD e1RM"), "dead", true)}
          {head(t("BODYWEIGHT"), null, true)}
          {head(t("MEET"), "meet", true)}
          {head(t("NEEDS"), "needs", true)}
        </div>

        {groups.map((group) => (
          <div role="rowgroup" key={group.title ?? "all"}>
            {group.title !== null && (
              <div className="border-b border-border/60 bg-background/40 px-4 py-1.5 text-[10.5px] tracking-[0.14em] text-muted">
                {group.title.toUpperCase()} <span className="text-muted-2">· {group.rows.length}</span>
              </div>
            )}
            {group.rows.map((row) => {
              const n = needs(row.id);
              const rpe = latest(row.rpe);
              const ready = latest(row.readiness);
              return (
                <div
                  role="row"
                  key={row.id}
                  className={`${COLS} border-b border-border/60 px-4 py-2 text-[12.5px] ${picked === row.id ? "bg-surface-3" : ""}`}
                >
                  <span role="cell" className="flex min-w-0 items-center gap-2">
                    <span
                      aria-label={n.tone === "miss" ? t("Needs attention today") : n.tone === "warn" ? t("Needs attention") : t("All good")}
                      className={`size-2 shrink-0 rounded-full ${n.tone === "miss" ? "bg-miss" : n.tone === "warn" ? "bg-warn" : "bg-ok"}`}
                    />
                    <span className="min-w-0">
                      <Link href={row.href} className="block truncate font-semibold hover:text-accent">
                        {row.name}
                      </Link>
                      <span className="block truncate text-[11px] text-muted-2">
                        {row.phase
                          ? `${row.phase.name} · ${
                              row.phase.status === "active"
                                ? t("wk {n}/{of}", { n: row.phase.week, of: row.phase.of })
                                : row.phase.status === "upcoming"
                                  ? t("starts {date}", { date: formatDate(row.phase.start) })
                                  : t("finished")
                            }`
                          : t("No program")}
                        {row.lastLog && ` · ${t("logged {date}", { date: formatDate(row.lastLog) })}`}
                      </span>
                    </span>
                  </span>
                  <span role="cell" className="flex gap-[3px]">
                    {row.done.map((p, i) => (
                      <span
                        key={i}
                        title={`${i === row.done.length - 1 ? t("This week") : t("{n} weeks ago", { n: row.done.length - 1 - i })}: ${p === null ? t("nothing due") : `${p}%`}`}
                        className={`size-[15px] rounded-[3px] ${doneTone(p)}`}
                      />
                    ))}
                  </span>
                  <span role="cell" className={`text-right font-semibold tabular-nums ${pctTone(row.weekPct)}`}>
                    {row.weekPct === null ? "—" : `${row.weekPct}%`}
                  </span>
                  <span role="cell" className="flex items-center gap-1.5" title={t("Logged RPE against the plan, week by week")}>
                    <Spark values={row.rpe} lo={-1.5} hi={1.5} tone={driftTone(rpe)} zero />
                    <span className={`font-semibold tabular-nums ${driftTone(rpe)}`}>{rpe === null ? "—" : signed(rpe)}</span>
                  </span>
                  <span role="cell" className="flex items-center gap-1.5" title={t("Readiness out of 5, week by week")}>
                    <Spark values={row.readiness} lo={1} hi={5} tone={readyTone(ready)} />
                    <span className={`font-semibold tabular-nums ${readyTone(ready)}`}>{ready === null ? "—" : ready.toFixed(1)}</span>
                  </span>
                  {(["squat", "bench", "dead"] as const).map((lift) => {
                    const l = row.lifts[lift];
                    return (
                      <span
                        role="cell"
                        key={lift}
                        className="text-right tabular-nums leading-tight"
                        title={l.onFile !== null ? t("1RM on file: {n} {u}", { n: l.onFile, u: row.unit }) : undefined}
                      >
                        <span className="block font-semibold">{l.e1rm ?? "—"}</span>
                        <span className={`block text-[10.5px] ${changeTone(l.change)}`}>{l.change === null ? "—" : `${signed(l.change)}%`}</span>
                      </span>
                    );
                  })}
                  <span role="cell" className="text-right tabular-nums leading-tight">
                    {row.bodyweight ? (
                      <>
                        <span className="block font-semibold">
                          {row.bodyweight.weight}
                          {row.bodyweight.change7 !== null && row.bodyweight.change7 !== 0 && (
                            <span className="ml-1 font-normal text-muted">
                              {row.bodyweight.change7 > 0 ? "↑" : "↓"}
                              {Math.abs(row.bodyweight.change7)}
                            </span>
                          )}
                        </span>
                        <span className={`block text-[10.5px] ${row.bodyweight.overClass !== null && row.bodyweight.overClass > 0 ? "text-warn" : "text-muted-2"}`}>
                          {row.bodyweight.overClass !== null && row.bodyweight.overClass > 0
                            ? t("+{n} over", { n: row.bodyweight.overClass })
                            : row.meet?.weightClass
                              ? t("in {class}", { class: row.meet.weightClass })
                              : row.bodyweight.age !== null && row.bodyweight.age > 0
                                ? t("{n}d ago", { n: row.bodyweight.age })
                                : t("7-day avg")}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-2">—</span>
                    )}
                  </span>
                  <span
                    role="cell"
                    title={row.meet ? `${row.meet.name}${row.meet.weightClass ? ` · ${row.meet.weightClass}` : ""}` : undefined}
                    className={`text-right tabular-nums ${!row.meet ? "text-muted-2" : row.meet.days <= 14 ? "text-warn" : ""}`}
                  >
                    {!row.meet ? "—" : row.meet.days === 0 ? t("today") : row.meet.days <= 21 ? t("{n}d", { n: row.meet.days }) : t("{n} wk", { n: Math.round(row.meet.days / 7) })}
                  </span>
                  <span role="cell" className="text-right">
                    <button
                      type="button"
                      onClick={() => onNeeds(row.id)}
                      disabled={n.count === 0}
                      title={n.count > 0 ? t("Show only {name} in the inbox", { name: row.name }) : t("All good")}
                      className={`min-w-6 rounded-full px-2 py-px text-[11px] font-semibold tabular-nums ${
                        n.count === 0 ? "bg-ok/12 text-ok" : n.tone === "miss" ? "bg-miss/18 text-miss hover:bg-miss/30" : "bg-warn/18 text-warn hover:bg-warn/30"
                      }`}
                    >
                      {n.count === 0 ? "✓" : n.count}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {average.length > 1 && (
          <div className={`${COLS} bg-surface-2 px-4 py-2 text-[12px] text-muted`}>
            <span className="font-semibold text-foreground">{t("Roster average")}</span>
            <span>{(() => {
              const m = mean(average.map((r) => latest(r.done)));
              return m === null ? "—" : t("{n}% this week", { n: Math.round(m) });
            })()}</span>
            <span />
            <span className="tabular-nums">{(() => {
              const m = mean(average.map((r) => latest(r.rpe)));
              return m === null ? "—" : signed(m);
            })()}</span>
            <span className="tabular-nums">{mean(average.map((r) => latest(r.readiness)))?.toFixed(1) ?? "—"}</span>
            {(["squat", "bench", "dead"] as const).map((lift) => {
              const m = mean(average.map((r) => r.lifts[lift].change));
              return (
                <span key={lift} className={`text-right tabular-nums ${changeTone(m)}`}>
                  {m === null ? "—" : `${signed(m)}%`}
                </span>
              );
            })}
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    </div>
  );
});
