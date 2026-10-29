import Link from "next/link";
import type { MeetLift } from "@prisma/client";
import type { OverviewData } from "@/app/overview/data";
import { dailyWeights, projectWeight } from "@/lib/bodyweight";
import { meetScore, projectedTotal, scoreName } from "@/lib/competition";
import { formatDate, weekdayOf, ymdOf } from "@/lib/dates";
import { LOCALE, t, weekdayShort } from "@/lib/i18n";
import { phaseSpan, type AthleteSummary } from "@/lib/overview";
import type { getMeetsBetween } from "@/lib/queries";
import { addDays, daysBetween } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";

/** How far ahead the timeline looks, and how close a meet has to be for its prep card. */
export const SEASON_WEEKS = 16;
const PREP_DAYS = 56;
/** A stretch with no program shorter than this is a long weekend, not a gap. */
const GAP_DAYS = 7;

type Kind = "hypertrophy" | "strength" | "peak" | "taper" | "deload" | "other";

/** What a phase is for, read off its name — in any of the app's languages. */
export function phaseKind(name: string): Kind {
  const n = name.toLowerCase();
  if (/deload|entlast|décharge|decharge|recover|erhol/.test(n)) return "deload";
  if (/taper|affût|affut/.test(n)) return "taper";
  if (/peak|pic|wettkampf|comp|meet|realiz|réalis/.test(n)) return "peak";
  if (/strength|kraft|force|intens|max/.test(n)) return "strength";
  if (/hypert|volume|accum|base|aufbau|masse|muscle|off.?season|gpp/.test(n)) return "hypertrophy";
  return "other";
}

const KIND_STYLE: Record<Kind, { label: string; className: string }> = {
  hypertrophy: { label: "Hypertrophy", className: "border-sky-500/45 bg-sky-500/20 text-foreground" },
  strength: { label: "Strength", className: "border-indigo-500/55 bg-indigo-500/30 text-foreground" },
  peak: { label: "Peak", className: "border-accent/60 bg-accent/30 text-foreground" },
  taper: { label: "Taper", className: "border-warn/45 bg-warn/20 text-foreground" },
  deload: { label: "Deload", className: "border-dashed border-muted-2 bg-transparent text-muted" },
  other: { label: "Other", className: "border-border bg-surface-3 text-foreground" },
};
const GAP = "border-dashed border-warn/55 bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--warn)_13%,transparent)_0_6px,transparent_6px_12px)] text-warn";

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
  const days = SEASON_WEEKS * 7;
  const end = addDays(thisWeek, days);
  const col = (ymd: string) => Math.min(days, Math.max(0, daysBetween(thisWeek, ymd))) + 2;
  const grid = { gridTemplateColumns: `170px repeat(${days}, minmax(0, 1fr))` };
  const todayCol = col(today);
  const short = new Intl.DateTimeFormat(LOCALE[activeSettings().language], { day: "numeric", month: "short", timeZone: "UTC" });

  const lanes = athletes.map((a) => {
    const spans = a.blocks.map((b) => ({ ...phaseSpan(b), name: b.phase, id: b.id }));
    const covered = (ymd: string) => spans.some((s) => ymd >= s.start && ymd < s.end);
    const gaps: { start: string; end: string }[] = [];
    for (let d = today; d < end; d = addDays(d, 1)) {
      if (covered(d)) continue;
      const last = gaps.at(-1);
      if (last && last.end === d) last.end = addDays(d, 1);
      else gaps.push({ start: d, end: addDays(d, 1) });
    }
    const until = spans.map((s) => s.end).sort().at(-1) ?? null;
    return {
      athlete: a,
      bars: spans.filter((s) => s.end > thisWeek && s.start < end),
      gaps: gaps.filter((g) => daysBetween(g.start, g.end) >= GAP_DAYS),
      meets: meets.filter((m) => m.athleteId === a.id),
      until,
    };
  });

  const prep = meets.filter((m) => daysBetween(today, ymdOf(m.date)) <= PREP_DAYS);
  const runningOut = lanes
    .filter((l) => l.until === null || l.until < end)
    .sort((a, b) => (a.until ?? "").localeCompare(b.until ?? ""));
  const programHref = (id: string) => `/programming?athlete=${id}`;

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
        {(Object.keys(KIND_STYLE) as Kind[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-[18px] rounded-[3px] border ${KIND_STYLE[k].className}`} />
            {t(KIND_STYLE[k].label)}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-[18px] rounded-[3px] border ${GAP}`} />
          {t("No program")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rotate-45 bg-cal-meet" />
          {t("Meet")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-accent" />
          {t("Today")}
        </span>
        <span className="ml-auto text-muted-2">{t("Phase colours come from their names: deload, taper, peak, strength, hypertrophy…")}</span>
      </div>

      <section aria-label={t("Season")} className={`${card} overflow-x-auto`}>
        <div className="min-w-[980px]">
          <div className="grid border-b border-border bg-surface-2" style={grid}>
            <span className="px-3.5 py-2 text-[10px] tracking-[0.14em] text-muted-2">{t("ATHLETE")}</span>
            {Array.from({ length: SEASON_WEEKS }, (_, w) => {
              const ymd = addDays(thisWeek, w * 7);
              const first = w === 0 || ymd.slice(5, 7) !== addDays(ymd, -7).slice(5, 7);
              return (
                <span
                  key={ymd}
                  style={{ gridColumn: `${w * 7 + 2} / span 7` }}
                  className={`truncate border-l border-border/60 px-1.5 py-2 text-[10.5px] tabular-nums ${first ? "font-semibold text-muted" : "text-muted-2"}`}
                >
                  {short.format(new Date(`${ymd}T00:00:00Z`))}
                </span>
              );
            })}
          </div>

          {lanes.map((lane) => (
            <div key={lane.athlete.id} className="grid h-11 border-b border-border/60" style={grid}>
              <span className="flex min-w-0 flex-col justify-center px-3.5" style={{ gridColumn: 1, gridRow: 1 }}>
                <Link href={programHref(lane.athlete.id)} className="truncate text-[12.5px] font-semibold hover:text-accent">
                  {lane.athlete.name}
                </Link>
                <span className={`truncate text-[10.5px] ${lane.until === null || lane.until <= addDays(today, 14) ? "text-miss" : "text-muted-2"}`}>
                  {lane.meets[0]
                    ? `${lane.meets[0].name} · ${t("{n}d", { n: daysBetween(today, ymdOf(lane.meets[0].date)) })}`
                    : lane.until === null
                      ? t("No program")
                      : lane.until < end
                        ? t("nothing after {date}", { date: formatDate(addDays(lane.until, -1)) })
                        : t("planned through")}
                </span>
              </span>
              {Array.from({ length: SEASON_WEEKS }, (_, w) => (
                <span key={w} aria-hidden className="border-l border-border/40" style={{ gridColumn: `${w * 7 + 2} / span 7`, gridRow: 1 }} />
              ))}
              {lane.bars.map((b) => {
                const kind = phaseKind(b.name);
                return (
                  <Link
                    key={b.id}
                    href={`/programming?athlete=${lane.athlete.id}&phase=${b.id}`}
                    title={`${b.name} · ${formatDate(b.start)} – ${formatDate(addDays(b.end, -1))}`}
                    style={{ gridColumn: `${col(b.start)} / ${col(b.end)}`, gridRow: 1 }}
                    className={`mx-px my-2 flex items-center overflow-hidden whitespace-nowrap rounded-md border px-2 text-[11px] font-medium hover:brightness-125 ${KIND_STYLE[kind].className}`}
                  >
                    {b.name}
                  </Link>
                );
              })}
              {lane.gaps.map((g) => (
                <Link
                  key={g.start}
                  href={programHref(lane.athlete.id)}
                  title={t("Nothing planned {from} – {to}", { from: formatDate(g.start), to: formatDate(addDays(g.end, -1)) })}
                  style={{ gridColumn: `${col(g.start)} / ${col(g.end)}`, gridRow: 1 }}
                  className={`mx-px my-2 flex items-center overflow-hidden whitespace-nowrap rounded-md border px-2 text-[11px] font-medium hover:brightness-125 ${GAP}`}
                >
                  + {t("Plan")}
                </Link>
              ))}
              {lane.meets.map((m) => (
                <span
                  key={m.id}
                  title={`${m.name} · ${formatDate(m.date)}${m.weightClass ? ` · ${m.weightClass}` : ""}`}
                  style={{ gridColumn: `${col(ymdOf(m.date))} / span 1`, gridRow: 1 }}
                  className="z-10 flex items-center justify-center"
                >
                  <span className="size-3 rotate-45 rounded-[2px] bg-cal-meet shadow-[0_0_0_3px_var(--surface)]" />
                </span>
              ))}
              <span aria-hidden className="pointer-events-none z-10 w-0.5 justify-self-center bg-accent" style={{ gridColumn: `${todayCol} / span 1`, gridRow: 1 }} />
            </div>
          ))}
        </div>
      </section>

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
