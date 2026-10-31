import Link from "next/link";
import { formatDate, ymdOf } from "@/lib/dates";
import { LOCALE, t } from "@/lib/i18n";
import { phaseSpan } from "@/lib/overview";
import { addDays, daysBetween } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";

/** How far ahead the timeline looks. */
export const SEASON_WEEKS = 16;
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

/** The solid colour of each kind, for the part of a phase already trained. */
export const KIND_FILL: Record<Kind, string> = {
  hypertrophy: "bg-sky-500",
  strength: "bg-indigo-500",
  peak: "bg-accent",
  taper: "bg-warn",
  deload: "bg-muted-2",
  other: "bg-muted",
};

export const KIND_STYLE: Record<Kind, { label: string; className: string }> = {
  hypertrophy: { label: "Hypertrophy", className: "border-sky-500/45 bg-sky-500/20 text-foreground" },
  strength: { label: "Strength", className: "border-indigo-500/55 bg-indigo-500/30 text-foreground" },
  peak: { label: "Peak", className: "border-accent/60 bg-accent/30 text-foreground" },
  taper: { label: "Taper", className: "border-warn/45 bg-warn/20 text-foreground" },
  deload: { label: "Deload", className: "border-dashed border-muted-2 bg-transparent text-muted" },
  other: { label: "Other", className: "border-border bg-surface-3 text-foreground" },
};
const GAP = "border-dashed border-warn/55 bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--warn)_13%,transparent)_0_6px,transparent_6px_12px)] text-warn";

export type TimelineAthlete = { id: string; name: string; blocks: { id: string; phase: string; startDate: Date | string; weeks: number }[] };
export type TimelineMeet = { id: string; athleteId: string; name: string; date: Date | string; weightClass: string | null };

/**
 * Athletes' phases on one timeline from this week on, meets as diamonds, and the weeks
 * with nothing planned marked to fill — the Season tab's, and one athlete's on their hub.
 */
export function SeasonTimeline({
  athletes,
  meets,
  today,
  thisWeek,
}: {
  athletes: TimelineAthlete[];
  meets: TimelineMeet[];
  today: string;
  thisWeek: string;
}) {
  const days = SEASON_WEEKS * 7;
  const end = addDays(thisWeek, days);
  const col = (ymd: string) => Math.min(days, Math.max(0, daysBetween(thisWeek, ymd))) + 2;
  const grid = { gridTemplateColumns: `170px repeat(${days}, minmax(0, 1fr))` };
  const todayCol = col(today);
  const short = new Intl.DateTimeFormat(LOCALE[activeSettings().language], { day: "numeric", month: "short", timeZone: "UTC" });
  const programHref = (id: string) => `/programming?athlete=${id}`;

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

  return (
    <div className="flex flex-col gap-4">
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

      <section aria-label={t("Season")} className="overflow-x-auto rounded-xl border border-border bg-surface">
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
            <div key={lane.athlete.id} className="grid h-11 border-b border-border/60 last:border-b-0" style={grid}>
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
    </div>
  );
}
