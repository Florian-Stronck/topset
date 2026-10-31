"use client";

import { useCoachActions } from "@/components/CoachActions";
import Link from "next/link";
import { ScoreToggle } from "@/components/competition/ScoreToggle";
import {
  best,
  daysUntil,
  LIFT_LABEL,
  MEET_LIFTS,
  maxFor,
  meetScore,
  ratesByNumber,
  scoreName,
  thirdsByLift,
  total,
  totalOf,
  weightOf,
  type MeetData,
  type Rate,
} from "@/lib/competition";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { daysBetween } from "@/lib/schedule";
import type { AthleteData } from "@/lib/types";

const share = (r: Rate) => (r.called === 0 ? 0 : r.made / r.called);
const round = (n: number) => Math.round(n * 10) / 10;

/** Every meet so far: the totals, every attempt, and what they say about picking the next ones. */
export function HistoryTab({
  athlete,
  meets,
  picked,
  today,
  scoring,
  onScoring,
  onNew,
}: {
  athlete: AthleteData;
  meets: MeetData[];
  picked: string;
  today: Date;
  scoring: "dots" | "gl";
  onScoring: (kind: "dots" | "gl") => void;
  /** Opens the new-meet form; null where meets can't be added. */
  onNew: (() => void) | null;
}) {
  const { meetHref } = useCoachActions();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  // Meets with something called, oldest first.
  const lifted = meets.filter((m) => m.attempts.some((a) => a.result !== "PENDING"));
  const scored = lifted.map((m) => {
    const sum = total(m.attempts);
    return { meet: m, total: sum, score: meetScore(sum, m.bodyweight, athlete.sex, athlete.unit, scoring) };
  });
  const addPast = onNew && (
    <button type="button" onClick={onNew} className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent">
      {t("+ Add a past meet")}
    </button>
  );

  if (lifted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <p className="text-[13px] text-muted">{t("No meet lifted yet. Results show here once attempts are called good or missed.")}</p>
        {addPast && <div className="mt-3">{addPast}</div>}
      </div>
    );
  }

  const totals = scored.filter((s): s is typeof s & { total: number } => s.total !== null);
  const bestTotal = totals.reduce<(typeof totals)[number] | null>((a, b) => (!a || b.total > a.total ? b : a), null);
  const scores = scored.filter((s) => s.score !== null).map((s) => s.score as number);
  const rates = ratesByNumber(lifted);
  const all = rates.reduce((a, r) => ({ made: a.made + r.made, called: a.called + r.called }), { made: 0, called: 0 });
  const perYear = (() => {
    if (totals.length < 2) return null;
    const first = totals[0];
    const last = totals[totals.length - 1];
    const days = daysBetween(first.meet.date.slice(0, 10), last.meet.date.slice(0, 10));
    return days < 90 ? null : round(((last.total - first.total) / days) * 365.25);
  })();
  const everyPr = totals.length >= 2 && totals.every((s, i) => i === 0 || s.total > totals[i - 1].total);
  const next = meets.find((m) => daysUntil(m.date, today) >= 0 && !lifted.includes(m)) ?? null;
  const planned = next ? totalOf((l) => weightOf(next.attempts, l, 3)) : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">
          {t(lifted.length === 1 ? "{n} meet since {date}" : "{n} meets since {date}", { n: lifted.length, date: formatDate(lifted[0].date, true) })}
        </span>
        <span className="flex-1" />
        {addPast}
        <ScoreToggle scoring={scoring} onScoring={onScoring} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("BEST TOTAL")} value={bestTotal ? `${bestTotal.total}` : "—"} unit={unit} note={bestTotal ? `${bestTotal.meet.name} · ${formatDate(bestTotal.meet.date, true)}` : t("no full total yet")} />
        <Stat
          label={t("BEST {score}", { score: scoreName() })}
          value={scores.length ? Math.max(...scores).toFixed(1) : "—"}
          note={
            scores.length >= 2
              ? t("{n} since the first meet", { n: `${Math.max(...scores) - scores[0] >= 0 ? "+" : ""}${round(Math.max(...scores) - scores[0])}` })
              : scores.length === 1
                ? t("one scored meet so far")
                : !athlete.sex
                  ? t("set the division on the athlete's card")
                  : t("needs a meet bodyweight")
          }
        />
        <Stat
          label={t("ATTEMPTS MADE")}
          value={`${all.made}`}
          unit={`/ ${all.called}`}
          note={t("{p}% · thirds {made} of {called}", { p: Math.round(share(all) * 100), made: rates[2].made, called: rates[2].called })}
        />
        <Stat
          label={t("TOTAL PER YEAR")}
          value={perYear === null ? "—" : `${perYear > 0 ? "+" : ""}${perYear}`}
          unit={perYear === null ? undefined : unit}
          note={everyPr ? t("Every meet a meet PR") : perYear === null ? t("needs two totals three months apart") : t("first total to latest")}
        />
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        <TotalsChart points={totals.map((s) => ({ total: s.total, score: s.score, date: s.meet.date }))} planned={planned} plannedScore={next ? meetScore(planned, next.bodyweight, athlete.sex, athlete.unit, scoring) : null} />
        <Lessons athlete={athlete} meets={lifted} rates={rates} unit={unit} />
      </div>

      <section aria-labelledby="h-every" className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
          <h2 id="h-every" className="text-[13px] font-semibold">{t("Every attempt")}</h2>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2.5 w-2.5 rounded-sm border border-[color:var(--ok)]/50 bg-[color:var(--ok)]/15" />
            {t("Good")}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2.5 w-2.5 rounded-sm border border-miss/60" />
            {t("No lift")}
          </span>
        </div>
        <div className="overflow-x-auto p-3 pt-1">
          <table className="w-full min-w-[900px] border-separate border-spacing-x-0.5 border-spacing-y-1 text-[12.5px]">
            <thead>
              <tr className="text-[10px] tracking-[0.14em] text-muted-2">
                <th scope="col" className="px-1 py-1.5 text-left font-normal">{t("MEET")}</th>
                <th scope="col" className="px-1 py-1.5 text-left font-normal">{t("BW")}</th>
                {MEET_LIFTS.map((lift) => (
                  <th key={lift} scope="colgroup" colSpan={3} className="px-1 py-1.5 text-left font-normal">
                    {t(LIFT_LABEL[lift]).toUpperCase()}
                  </th>
                ))}
                <th scope="col" className="px-1 py-1.5 text-right font-normal">{t("TOTAL")}</th>
                <th scope="col" className="px-1 py-1.5 text-right font-normal">{scoreName()}</th>
              </tr>
            </thead>
            <tbody>
              {scored.toReversed().map(({ meet, total: sum, score }) => (
                <tr key={meet.id}>
                  <th scope="row" className="px-1 text-left font-normal">
                    <Link href={meetHref(athlete.id, meet.id)} className={`block rounded px-1 py-0.5 hover:bg-surface-2 ${meet.id === picked ? "bg-surface-2" : ""}`}>
                      <span className="block truncate font-medium">{meet.name}</span>
                      <span className="block text-[11px] text-muted-2">{formatDate(meet.date, true)}</span>
                    </Link>
                  </th>
                  <td className="px-1 tabular-nums text-muted">{meet.bodyweight ?? "—"}</td>
                  {MEET_LIFTS.flatMap((lift) =>
                    [1, 2, 3].map((number) => {
                      const a = meet.attempts.find((x) => x.lift === lift && x.number === number);
                      const style =
                        a?.result === "GOOD"
                          ? "border-[color:var(--ok)]/40 bg-[color:var(--ok)]/10"
                          : a?.result === "MISS"
                            ? "border-miss/60 text-miss line-through"
                            : "border-border text-muted-2";
                      return (
                        <td key={`${lift}${number}`} className="px-0">
                          <span className={`block rounded border py-1.5 text-center font-medium tabular-nums ${style}`}>{a?.weight ?? "—"}</span>
                        </td>
                      );
                    }),
                  )}
                  <td className="px-1 text-right font-semibold tabular-nums">{sum ?? "—"}</td>
                  <td className="px-1 text-right tabular-nums text-muted">{score === null ? "—" : score.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-[10px] tracking-[0.16em] text-muted-2">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-[12px] text-muted-2">{unit}</span>}
      </div>
      <div className="truncate text-[11.5px] text-muted-2">{note}</div>
    </div>
  );
}

/** The total meet by meet, and the next meet's planned thirds dashed on the end. */
function TotalsChart({ points, planned, plannedScore }: { points: { total: number; score: number | null; date: string }[]; planned: number | null; plannedScore: number | null }) {
  const all = [...points.map((p) => ({ ...p, plan: false })), ...(planned !== null ? [{ total: planned, score: plannedScore, date: "", plan: true }] : [])];
  const values = all.map((p) => p.total);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(5, (hi - lo) * 0.15);
  const W = 640;
  const H = 170;
  const x = (i: number) => ((i + 0.5) * W) / all.length;
  const y = (v: number) => H - 8 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 16);
  const line = (from: number, to: number) => all.slice(from, to).map((p, i) => `${x(from + i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");

  return (
    <section aria-labelledby="h-totals" className="min-w-0 flex-[1.5_1_460px] rounded-xl border border-border bg-surface p-4">
      <h2 id="h-totals" className="text-[13px] font-semibold">{t("Total, meet by meet")}</h2>
      {planned !== null && <p className="text-[11px] text-muted-2">{t("Dashed: the thirds planned for the next meet")}</p>}
      {all.length < 2 ? (
        <p className="mt-3 text-[12px] text-muted-2">{t("A line shows from the second total on.")}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 h-[170px] w-full" role="img" aria-label={t("Total by meet, from {a} to {b}", { a: values[0], b: values[values.length - 1] })}>
          <polyline points={line(0, points.length)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {planned !== null && points.length > 0 && (
            <polyline points={line(points.length - 1, all.length)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      )}
      <div className="mt-1 grid gap-1 text-center text-[11px]" style={{ gridTemplateColumns: `repeat(${all.length}, minmax(0, 1fr))` }}>
        {all.map((p, i) => (
          <span key={i} className="flex flex-col">
            <span className={`text-[12.5px] font-semibold tabular-nums ${p.plan ? "text-muted" : ""}`}>{p.total}</span>
            <span className="tabular-nums text-muted">{p.score === null ? "" : p.score.toFixed(1)}</span>
            <span className="text-muted-2">{p.plan ? t("planned") : formatDate(p.date, true)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/** How often each attempt goes, which lift's thirds to trust, and the platform against the gym. */
function Lessons({ athlete, meets, rates, unit }: { athlete: AthleteData; meets: MeetData[]; rates: Rate[]; unit: string }) {
  const thirds = thirdsByLift(meets);
  const judged = MEET_LIFTS.filter((l) => thirds[l].called >= 2).sort((a, b) => share(thirds[b]) - share(thirds[a]));
  const surest = judged[0];
  const shakiest = judged.length > 1 && share(thirds[judged[judged.length - 1]]) < share(thirds[surest]) ? judged[judged.length - 1] : null;
  const labels = [t("Openers"), t("Seconds"), t("Thirds")];

  return (
    <section aria-labelledby="h-lessons" className="min-w-0 flex-[1_1_320px] rounded-xl border border-border bg-surface p-4">
      <h2 id="h-lessons" className="text-[13px] font-semibold">{t("What the meets say")}</h2>
      <div className="mt-3 space-y-1.5">
        {rates.map((r, i) => (
          <div key={labels[i]} className="grid grid-cols-[64px_minmax(0,1fr)_44px] items-center gap-2.5 text-[12px]">
            <span className="text-muted">{labels[i]}</span>
            <span className="h-2 overflow-hidden rounded bg-surface-2">
              <span className={`block h-2 ${share(r) >= 0.8 ? "bg-[color:var(--ok)]" : "bg-warn"}`} style={{ width: `${share(r) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">
              {r.made}/{r.called}
            </span>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-2 text-[12.5px] leading-snug">
        {surest && (
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[color:var(--ok)]" />
            <span>
              <span className="font-semibold">{t("{lift} thirds {made} of {called}.", { lift: t(LIFT_LABEL[surest]), made: thirds[surest].made, called: thirds[surest].called })}</span>{" "}
              <span className="text-muted">{t("The surest place to push for the total.")}</span>
            </span>
          </li>
        )}
        {shakiest && (
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warn" />
            <span>
              <span className="font-semibold">{t("{lift} thirds {made} of {called}.", { lift: t(LIFT_LABEL[shakiest]), made: thirds[shakiest].made, called: thirds[shakiest].called })}</span>{" "}
              <span className="text-muted">{t("Keep this third close to the max on file.")}</span>
            </span>
          </li>
        )}
      </ul>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-[12px]">
        <span className="text-muted-2">{t("Best")}</span>
        <span className="text-right text-muted-2">{t("On the platform")}</span>
        <span className="text-right text-muted-2">{t("1RM on file")}</span>
        {MEET_LIFTS.map((lift) => {
          const made = meets.map((m) => best(m.attempts, lift)).filter((w): w is number => w !== null);
          return [
            <span key={`${lift}-n`}>{t(LIFT_LABEL[lift])}</span>,
            <span key={`${lift}-p`} className="text-right tabular-nums">
              {made.length ? `${Math.max(...made)} ${unit}` : "—"}
            </span>,
            <span key={`${lift}-g`} className="text-right tabular-nums">
              {maxFor(lift, athlete) ?? "—"}
            </span>,
          ];
        })}
      </div>
    </section>
  );
}
