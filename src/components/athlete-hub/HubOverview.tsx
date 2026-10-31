"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { HubData } from "@/app/athletes/hub";
import { updateAthlete, updateBlockMaxes } from "@/app/programming/actions";
import { KIND_FILL, KIND_STYLE, phaseKind } from "@/components/SeasonTimeline";
import { scoreName } from "@/lib/competition";
import type { DayStatus } from "@/lib/compliance";
import { formatDate, weekdayOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { LIFT_COLOR, LIFT_LABEL, LIFT_ORDER, type LiftKey } from "@/lib/progress";
import { latest, RAISE_MAX } from "@/lib/roster";

const card = "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4";
const label = "text-[10.5px] font-medium tracking-[0.14em] text-muted-2";
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const round1 = (n: number) => Math.round(n * 10) / 10;

const CELL: Record<DayStatus, string> = {
  done: "bg-ok",
  partial: "bg-ok/40",
  missed: "bg-miss",
  today: "bg-surface-2 ring-1 ring-inset ring-accent",
  upcoming: "bg-surface-2 ring-1 ring-inset ring-border",
  rest: "bg-surface-2",
  none: "bg-surface-2/50",
};

/**
 * A line through the values, gaps where there are none, and a dashed level to read it
 * against. Stretches to its box; the strokes keep their width.
 */
function Line({ values, level = null, color, height, label: name }: { values: (number | null)[]; level?: number | null; color: string; height: number; label: string }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return <div style={{ height }} className="grid place-items-center text-[12px] text-muted-2">{t("Nothing logged yet")}</div>;
  const all = level === null ? known : [...known, level];
  const pad = (Math.max(...all) - Math.min(...all)) * 0.15 || 1;
  const lo = Math.min(...all) - pad;
  const hi = Math.max(...all) + pad;
  const W = 300;
  const x = (i: number) => (values.length === 1 ? W / 2 : (i * W) / (values.length - 1));
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const runs: string[][] = [[]];
  values.forEach((v, i) => (v === null ? runs.push([]) : runs[runs.length - 1].push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }} className="w-full overflow-visible" role="img" aria-label={name}>
      {level !== null && <line x1={0} x2={W} y1={y(level)} y2={y(level)} className="stroke-muted-2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      {runs
        .filter((r) => r.length > 0)
        .map((r, i) =>
          r.length === 1 ? (
            <circle key={i} cx={r[0].split(",")[0]} cy={r[0].split(",")[1]} r={2.5} fill={color} />
          ) : (
            <polyline key={i} points={r.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ),
        )}
    </svg>
  );
}

/**
 * The athlete hub's Overview: where they are in the plan, the next meet, how ready they've
 * felt, where the main lifts are heading — with a button to raise a max the training has
 * passed — then the training log, the latest sessions, PRs, bodyweight and what waits on
 * the coach.
 */
export function HubOverview({ data, sex, readOnly }: { data: HubData; sex: string | null; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { row, program } = data;
  const unit = row.unit;
  const done = row.done.filter((p): p is number => p !== null);
  const donePct = done.length === 0 ? null : Math.round(done.reduce((a, b) => a + b, 0) / done.length);

  const raise = (lift: LiftKey, value: number) =>
    start(async () => {
      const patch = lift === "squat" ? { squat1RM: value } : lift === "bench" ? { bench1RM: value } : { dead1RM: value };
      // The max the targets use: the phase's own when it has one, else the athlete's.
      if (row.lifts[lift].onPhase && row.phaseId) await updateBlockMaxes(row.phaseId, patch);
      else await updateAthlete(data.athleteId, patch);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
        <section aria-label={t("Now")} className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={label}>{t("NOW")}</h2>
            {program && <span className="text-[12px] text-muted">{t("week {n} of {of}", { n: program.week, of: program.of })}</span>}
          </div>
          {program && row.phase ? (
            <>
              <div>
                <div className="text-[16px] font-semibold">
                  {row.phase.name} · {t("week {n} of {of}", { n: row.phase.week, of: row.phase.of })}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {program.name}
                  {row.phase.status === "upcoming" && ` · ${t("starts {date}", { date: formatDate(row.phase.start) })}`}
                  {row.phase.status === "done" && ` · ${t("finished")}`}
                </div>
              </div>
              <div className="relative flex gap-1" role="img" aria-label={t("{n} of {of} weeks gone by", { n: program.week, of: program.of })}>
                {program.phases.map((p) => {
                  const kind = phaseKind(p.name);
                  return (
                    <div key={p.id} className="flex min-w-0 flex-col gap-1" style={{ flex: p.weeks }}>
                      <div className={`h-2 overflow-hidden rounded-full border ${KIND_STYLE[kind].className}`}>
                        <div className={`h-full ${KIND_FILL[kind]}`} style={{ width: `${p.done * 100}%` }} />
                      </div>
                      <span className={`truncate text-[11px] ${p.now ? "text-foreground" : "text-muted-2"}`}>{p.name}</span>
                    </div>
                  );
                })}
                {program.meetAt !== null && row.meet && (
                  <span
                    title={`${row.meet.name} · ${t("in {n} days", { n: row.meet.days })}`}
                    className="absolute top-1 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-cal-meet shadow-[0_0_0_3px_var(--surface)]"
                    style={{ left: `${program.meetAt * 100}%` }}
                  />
                )}
              </div>
              {data.today ? (
                <Link href={data.today.href} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] hover:text-accent">
                  <span className="min-w-0 flex-1 truncate">
                    {t("Today")} · <span className="font-semibold">{data.today.label}</span>
                  </span>
                  <span className="text-muted">
                    {data.today.done === 0 ? t("not logged yet") : t("{done}/{of} sets", { done: data.today.done, of: data.today.prescribed })} →
                  </span>
                </Link>
              ) : (
                <span className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-muted">{t("Nothing on the plan today")}</span>
              )}
            </>
          ) : (
            <p className="text-[12.5px] text-muted">
              {t("No program yet")} ·{" "}
              <Link href={`/programming?athlete=${data.athleteId}`} className="text-accent">
                {t("Open programming")}
              </Link>
            </p>
          )}
        </section>

        <section aria-label={t("Next meet")} className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={label}>{t("NEXT MEET")}</h2>
            <Link href={`/competition?athlete=${data.athleteId}`} className="text-[12px] text-muted hover:text-accent">
              {t("Competition")} →
            </Link>
          </div>
          {row.meet ? (
            <div className="flex items-baseline gap-2.5">
              <span className="text-[28px] font-semibold tabular-nums">{row.meet.days}</span>
              <span className="min-w-0 text-[13px] text-muted">
                {t("days")} · {row.meet.name}
              </span>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">{t("None planned")}</p>
          )}
          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <div className="flex justify-between gap-2">
              <span className="text-muted">{t("Total from e1RMs")}</span>
              <span className="font-semibold tabular-nums">
                {data.projected ? `${data.projected.total} ${unit}` : "—"}
                {data.onFileTotal !== null && <span className="font-normal text-muted"> / {t("{n} on file", { n: data.onFileTotal })}</span>}
              </span>
            </div>
            {data.projected?.score != null && (
              <div className="flex justify-between gap-2">
                <span className="text-muted">{scoreName()}</span>
                <span className="tabular-nums">{round1(data.projected.score)}</span>
              </div>
            )}
            {row.bodyweight && (
              <div className="flex justify-between gap-2">
                <span className="text-muted">{row.meet?.weightClass ? t("Class {c}", { c: row.meet.weightClass }) : t("Bodyweight")}</span>
                <span className={`tabular-nums ${row.bodyweight.overClass !== null && row.bodyweight.overClass > 0 ? "text-warn" : ""}`}>
                  {row.bodyweight.weight} {unit}
                  {row.bodyweight.overClass !== null &&
                    ` · ${row.bodyweight.overClass > 0 ? t("{n} over", { n: row.bodyweight.overClass }) : t("{n} under", { n: round1(-row.bodyweight.overClass) })}`}
                </span>
              </div>
            )}
          </div>
          {!sex && data.projected && <p className="text-[11px] text-muted-2">{t("Set the division on the Profile tab for a meet score.")}</p>}
        </section>

        <section aria-label={t("Readiness")} className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={label}>{t("READINESS · 14 DAYS")}</h2>
            <Link href={`/tracking?athlete=${data.athleteId}&view=wellness#checkins`} className="text-[12px] text-muted hover:text-accent">
              {t("Check-ins")} →
            </Link>
          </div>
          {data.readiness.avg7 === null && data.readiness.days.every((d) => d === null) ? (
            <p className="text-[12.5px] text-muted">{t("No check-ins answered in two weeks.")}</p>
          ) : (
            <>
              <div className="flex items-end gap-4">
                <div className="shrink-0">
                  <div className="text-[28px] font-semibold tabular-nums">{data.readiness.avg7?.toFixed(1) ?? "—"}</div>
                  <div className="text-[11.5px] text-muted">{t("7-day average")}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <Line values={data.readiness.days} level={3} color="var(--ok)" height={52} label={t("Readiness, last 14 days")} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {data.readiness.parts.map((p) => (
                  <div key={p.label} className="grid grid-cols-[minmax(0,90px)_minmax(0,1fr)_32px] items-center gap-2.5 text-[12px]">
                    <span className="truncate text-muted">{p.label}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <span className={`block h-full ${p.value <= 2.5 ? "bg-miss" : p.value < 3.5 ? "bg-warn" : "bg-ok"}`} style={{ width: `${(p.value / 5) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{p.value.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <section aria-label={t("Estimated 1RM")} className={card}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[14px] font-semibold">{t("Estimated 1RM · {n} weeks", { n: data.weeks.length })}</h2>
          <span className="text-[12px] text-muted">{t("The best top set each week, off their RPE chart. Dashed: the max the targets use.")}</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
          {LIFT_ORDER.map((lift) => {
            const { e1rm, onFile } = row.lifts[lift];
            const now = latest(data.e1rm[lift]);
            const delta = now !== null && onFile ? round1((now / onFile - 1) * 100) : null;
            const canRaise = !readOnly && e1rm !== null && onFile !== null && e1rm >= onFile * RAISE_MAX;
            return (
              <div key={lift} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 px-3.5 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{t(LIFT_LABEL[lift])}</span>
                  <span className="text-[12px] text-muted">{onFile !== null ? t("max {n}", { n: onFile }) : t("no max")}</span>
                  <span className="ml-auto text-[18px] font-semibold tabular-nums">{now ?? "—"}</span>
                  {delta !== null && <span className={`text-[12px] tabular-nums ${delta >= 1 ? "text-ok" : delta < 0 ? "text-muted-2" : "text-muted"}`}>{signed(delta)}%</span>}
                </div>
                <Line values={data.e1rm[lift]} level={onFile} color={LIFT_COLOR[lift]} height={84} label={t("{lift} estimated 1RM by week", { lift: t(LIFT_LABEL[lift]) })} />
                {canRaise && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => raise(lift, e1rm)}
                    className="self-start rounded-lg border border-ok/50 px-2.5 py-1 text-[11.5px] font-medium text-ok hover:bg-ok/10 disabled:opacity-50"
                  >
                    {t("Set max to {n} {u}", { n: e1rm, u: unit })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <section aria-label={t("Training log")} className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-semibold">{t("Training log")}</h2>
            {donePct !== null && <span className="text-[12px] text-muted">{t("{n}% of sets done", { n: donePct })}</span>}
          </div>
          <div className="flex gap-2">
            <div className="grid grid-rows-[repeat(7,14px)] gap-[3px] text-[10px] leading-[14px] text-muted-2" aria-hidden>
              {(data.heat[0] ?? []).map((d) => (
                <span key={d.ymd}>{weekdayShort(weekdayOf(d.ymd)).slice(0, 2)}</span>
              ))}
            </div>
            <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${data.heat.length}, minmax(0, 1fr))` }}>
              {data.heat.map((week, i) => (
                <div key={i} className="grid grid-rows-[repeat(7,14px)] gap-[3px]">
                  {week.map((d) => (
                    <span key={d.ymd} title={`${formatDate(d.ymd)}${d.label ? ` · ${d.label}` : ""}`} className={`rounded-[3px] ${CELL[d.status]}`} />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted">
            {(
              [
                ["done", t("Done")],
                ["partial", t("Part")],
                ["missed", t("Missed")],
                ["today", t("Today")],
              ] as const
            ).map(([s, name]) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`size-2.5 rounded-[2px] ${CELL[s]}`} />
                {name}
              </span>
            ))}
          </div>
        </section>

        <section aria-label={t("Recent sessions")} className={`${card} gap-0 p-0`}>
          <div className="flex items-baseline justify-between gap-2 px-4 pb-2 pt-4">
            <h2 className="text-[14px] font-semibold">{t("Recent sessions")}</h2>
            <Link href={`/tracking?athlete=${data.athleteId}`} className="text-[12px] text-muted hover:text-accent">
              {t("All in Tracking")} →
            </Link>
          </div>
          {data.sessions.length === 0 && <p className="px-4 pb-4 text-[12.5px] text-muted">{t("Nothing logged yet")}</p>}
          {data.sessions.map((s) => (
            <Link
              key={s.dayId}
              href={s.href}
              className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_56px_44px] items-center gap-2.5 border-t border-border px-4 py-2 text-[12.5px] hover:bg-surface-2"
            >
              <span className="truncate whitespace-nowrap text-muted">
                {weekdayShort(weekdayOf(s.ymd))} {formatDate(s.ymd)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {s.label} · {t("week {n}", { n: s.week })}
                </span>
                <span className="block truncate text-[11.5px] text-muted-2">
                  {[s.reviewed ? t("Reviewed") : t("To review"), s.notes > 0 ? t(s.notes === 1 ? "{n} note" : "{n} notes", { n: s.notes }) : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className={`text-right tabular-nums ${s.done < s.prescribed ? "text-warn" : "text-muted"}`}>
                {s.done}/{s.prescribed}
              </span>
              <span
                className={`text-right font-semibold tabular-nums ${s.drift === null ? "text-muted-2" : Math.abs(s.drift) >= 1 ? "text-miss" : Math.abs(s.drift) >= 0.5 ? "text-warn" : "text-muted"}`}
                title={t("RPE against the plan")}
              >
                {s.drift === null ? "—" : signed(s.drift)}
              </span>
            </Link>
          ))}
        </section>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-start gap-4">
        <section aria-label={t("Keep an eye on")} className={card}>
          <h2 className="text-[14px] font-semibold">{t("Keep an eye on")}</h2>
          {data.items.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("Nothing waiting on you.")}</p>
          ) : (
            data.items.map((i) => (
              <div key={i.key} className="flex items-start gap-2.5 text-[12.5px]">
                <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${i.urgent ? "bg-miss" : "bg-warn"}`} />
                <span className="min-w-0 flex-1 leading-snug">{i.text}</span>
                <Link href={i.href} className="shrink-0 text-[12px] text-muted hover:text-accent">
                  {i.hrefLabel} →
                </Link>
              </div>
            ))
          )}
        </section>

        <section aria-label={t("Recent PRs")} className={card}>
          <h2 className="text-[14px] font-semibold">{t("Recent PRs")}</h2>
          {data.prs.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("None in the last two weeks.")}</p>
          ) : (
            data.prs.map((p) => (
              <Link key={p.id} href={p.href} className="flex items-center gap-2.5 text-[12.5px] hover:text-accent">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[#f5c542]" />
                <span className="min-w-0 flex-1 truncate font-medium">{p.text}</span>
                <span className="text-[11.5px] text-muted-2">{formatDate(p.ymd)}</span>
              </Link>
            ))
          )}
        </section>

        <section aria-label={t("Bodyweight")} className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-semibold">{t("Bodyweight")}</h2>
            {row.bodyweight && (
              <span className="text-[12px] tabular-nums text-muted">
                {row.bodyweight.weight} {unit}
                {row.bodyweight.change7 !== null && ` · ${signed(row.bodyweight.change7)} ${t("in 7 days")}`}
              </span>
            )}
          </div>
          {data.weights.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("No weigh-in in four weeks.")}</p>
          ) : (
            <Line values={data.weights.map((w) => w.weight)} level={row.meet?.limit ?? null} color="var(--foreground)" height={64} label={t("Bodyweight, last four weeks")} />
          )}
          {data.weights.length > 0 && row.meet?.limit != null && (
            <span className="text-[11px] text-muted-2">{t("Dashed: the class limit, {n} {u}", { n: row.meet.limit, u: unit })}</span>
          )}
        </section>
      </div>
    </div>
  );
}
