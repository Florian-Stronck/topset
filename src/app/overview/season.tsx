import Link from "next/link";
import type { MeetLift } from "@prisma/client";
import type { OverviewData } from "@/app/overview/data";
import { dailyWeights, projectWeight } from "@/lib/bodyweight";
import { meetScore, projectedTotal, scoreName } from "@/lib/competition";
import { formatDate, weekdayOf, ymdOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { phaseSpan, type AthleteSummary } from "@/lib/overview";
import type { getMeetsBetween } from "@/lib/queries";
import { addDays, daysBetween } from "@/lib/schedule";
import { SEASON_WEEKS, SeasonTimeline } from "@/components/SeasonTimeline";

export { SEASON_WEEKS };
/** How close a meet has to be for its prep card. */
const PREP_DAYS = 56;

const card = "rounded-xl border border-border bg-surface";
const LIFTS: MeetLift[] = ["SQUAT", "BENCH", "DEADLIFT"];
const LIFT_NAME: Record<MeetLift, string> = { SQUAT: "Squat", BENCH: "Bench", DEADLIFT: "Deadlift" };

/**
 * The season ahead: every athlete's phases on one timeline, meets as diamonds, and the
 * weeks with nothing planned marked to fill. Under it, the meets coming up with their
 * attempts, total and bodyweight, and who runs out of program first.
 */
export function SeasonPane({
  data,
  athletes,
  meets,
}: {
  data: OverviewData;
  athletes: AthleteSummary[];
  meets: Awaited<ReturnType<typeof getMeetsBetween>>;
}) {
  const { today, thisWeek } = data;
  const end = addDays(thisWeek, SEASON_WEEKS * 7);
  const lanes = athletes.map((a) => ({ athlete: a, until: a.blocks.map((b) => phaseSpan(b).end).sort().at(-1) ?? null }));

  const prep = meets.filter((m) => daysBetween(today, ymdOf(m.date)) <= PREP_DAYS);
  const runningOut = lanes
    .filter((l) => l.until === null || l.until < end)
    .sort((a, b) => (a.until ?? "").localeCompare(b.until ?? ""));
  const programHref = (id: string) => `/programming?athlete=${id}`;

  return (
    <div className="mt-5 flex flex-col gap-4">
      <SeasonTimeline athletes={athletes} meets={meets} today={today} thisWeek={thisWeek} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {prep.length === 0 && <p className={`${card} px-4 py-6 text-center text-[12px] text-muted-2`}>{t("No meets in the next 8 weeks.")}</p>}
          {prep.map((m) => {
            const a = athletes.find((x) => x.id === m.athleteId)!;
            const row = data.rows.find((r) => r.id === m.athleteId);
            const unit = a.unit === "LB" ? "lb" : "kg";
            const day = ymdOf(m.date);
            const total = projectedTotal(m.attempts);
            const weight = row?.bodyweight?.weight ?? null;
            const score = meetScore(total, m.bodyweight ?? weight, a.sex, a.unit);
            const limit = row?.meet?.limit ?? null;
            const projected = projectWeight(dailyWeights(data.weights.get(a.id) ?? []), today, day)?.weight ?? null;
            const drafted = m.attempts.filter((x) => x.weight !== null).length;
            const e1rmTotal = (["squat", "bench", "dead"] as const).reduce<number | null>((sum, l) => {
              const v = row?.lifts[l].e1rm ?? row?.lifts[l].onFile ?? null;
              return sum === null || v === null ? null : sum + v;
            }, 0);
            const planned = a.blocks.some((b) => {
              const s = phaseSpan(b);
              return day >= s.start && day < s.end;
            });
            const checks = [
              { ok: drafted >= 9, text: drafted >= 9 ? t("Attempts drafted") : t("{n} of 9 attempts drafted", { n: drafted }) },
              { ok: planned, text: planned ? t("Program runs to the meet") : t("No program on meet day") },
              ...(limit !== null
                ? [
                    {
                      ok: projected !== null && projected <= limit,
                      text:
                        projected === null
                          ? t("Not enough weigh-ins to project bodyweight")
                          : projected <= limit
                            ? t("On track: {w} {u} at weigh-in", { w: projected, u: unit })
                            : t("Trend says {w} {u} at weigh-in — {n} over", { w: projected, u: unit, n: Math.round((projected - limit) * 10) / 10 }),
                    },
                  ]
                : []),
            ];
            return (
              <section key={m.id} className={`${card} flex flex-col gap-4 p-4`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span aria-hidden className="size-2.5 rotate-45 rounded-[2px] bg-cal-meet" />
                  <h2 className="text-[15px] font-semibold">
                    {a.name} · {m.name}
                  </h2>
                  <span className="text-[12px] text-muted">
                    {weekdayShort(weekdayOf(day))} {formatDate(day)} · {t("{n} days", { n: daysBetween(today, day) })}
                    {m.weightClass && ` · ${m.weightClass}`}
                  </span>
                  <Link
                    href={`/competition?athlete=${a.id}&meet=${m.id}`}
                    className="ml-auto rounded-lg border border-border px-3 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
                  >
                    {t("Open meet")} →
                  </Link>
                </div>
                <div className="flex flex-wrap gap-6">
                  <div>
                    <div className="text-[10px] tracking-[0.14em] text-muted-2">{t("PLANNED TOTAL")}</div>
                    <div className="text-[24px] font-semibold tabular-nums">{total === null ? "—" : `${total} ${unit}`}</div>
                    <div className="text-[12px] text-muted">
                      {score !== null && `${scoreName()} ≈ ${Math.round(score)} · `}
                      {e1rmTotal !== null ? t("e1RM total {n}", { n: e1rmTotal }) : t("no e1RM yet")}
                    </div>
                  </div>
                  <table className="min-w-[260px] flex-1 overflow-hidden rounded-lg text-[12.5px] tabular-nums">
                    <thead>
                      <tr className="bg-surface-2 text-[10px] tracking-[0.12em] text-muted-2">
                        <th className="px-3 py-1.5 text-left font-normal">{t("ATTEMPTS")}</th>
                        <th className="px-3 py-1.5 text-right font-normal">1</th>
                        <th className="px-3 py-1.5 text-right font-normal">2</th>
                        <th className="px-3 py-1.5 text-right font-normal">3</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LIFTS.map((lift) => (
                        <tr key={lift} className="border-t border-border/60">
                          <td className="px-3 py-1.5 text-muted">{t(LIFT_NAME[lift])}</td>
                          {[1, 2, 3].map((n) => (
                            <td key={n} className={`px-3 py-1.5 text-right ${n === 3 ? "font-semibold" : ""}`}>
                              {m.attempts.find((x) => x.lift === lift && x.number === n)?.weight ?? "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="flex flex-col gap-1.5 text-[12.5px]">
                  {checks.map((c) => (
                    <li key={c.text} className={`flex gap-2 ${c.ok ? "" : "text-warn"}`}>
                      <span className={c.ok ? "text-ok" : ""}>{c.ok ? "✓" : "✕"}</span>
                      {c.text}
                    </li>
                  ))}
                  {weight !== null && limit !== null && (
                    <li className="text-[11.5px] text-muted-2">{t("Now {w} {u} (7-day average) against a {l} {u} limit", { w: weight, u: unit, l: limit })}</li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>

        <section aria-label={t("Gaps to plan")} className={`${card} overflow-hidden`}>
          <h2 className="px-4 pb-2 pt-3.5 text-[11px] font-medium tracking-[0.16em] text-muted-2">{t("GAPS TO PLAN")}</h2>
          {runningOut.length === 0 && <p className="border-t border-border/60 px-4 py-4 text-[12px] text-muted-2">{t("Everyone is planned through.")}</p>}
          {runningOut.map((l) => (
            <div key={l.athlete.id} className="flex items-center gap-2.5 border-t border-border/60 px-4 py-2.5">
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${l.until === null || l.until <= addDays(today, 14) ? "bg-miss" : "bg-warn"}`}
              />
              <span className="min-w-0 flex-1 text-[12.5px]">
                <b className="font-semibold">{l.athlete.name}</b>{" "}
                <span className="text-muted">
                  ·{" "}
                  {l.until === null
                    ? t("no program")
                    : l.until <= today
                      ? t("ran out {date}", { date: formatDate(addDays(l.until, -1)) })
                      : t("nothing after {date}", { date: formatDate(addDays(l.until, -1)) })}
                </span>
              </span>
              <Link
                href={programHref(l.athlete.id)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11.5px] hover:border-accent hover:text-accent"
              >
                {t("Plan")}
              </Link>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
