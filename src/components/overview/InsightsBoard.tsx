"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { updateAthlete, updateBlockMaxes } from "@/app/programming/actions";
import { useCommands, type Command } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { FOREVER, isSnoozed, liveSnoozes } from "@/lib/inbox";
import { setPref, usePref } from "@/lib/prefs";
import { LIFT_LABEL, LIFT_ORDER, type LiftKey } from "@/lib/progress";
import type { Suggestion } from "@/lib/roster";

export type Kpi = { label: string; value: string; delta: string; tone: "ok" | "warn" | "plain"; values: (number | null)[] };
export type Note = { athlete: string; day: string; text: string };
type Shown = Suggestion & { athlete: string; href: string; unit: string; phaseId: string | null; onPhase: boolean };

const TONE = { ok: "text-ok", warn: "text-warn", plain: "text-muted", miss: "text-miss" } as const;
const DOT = { ok: "bg-ok", warn: "bg-warn", miss: "bg-miss" } as const;
const card = "rounded-xl border border-border bg-surface";

function Spark({ values, tone }: { values: (number | null)[]; tone: string }) {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return <span className="w-[72px]" />;
  const lo = Math.min(...v);
  const hi = Math.max(...v) === lo ? lo + 1 : Math.max(...v);
  const points = values
    .map((x, i) => (x === null ? null : `${(2 + (i * 68) / (values.length - 1)).toFixed(1)},${(24 - ((x - lo) / (hi - lo)) * 20).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  return (
    <svg width={72} height={26} aria-hidden className={tone}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Insights' client side: the week in five numbers, the suggestions (applied or dismissed
 * from here), the estimated maxes per lift, and the athletes' own words.
 */
export function InsightsBoard({
  kpis,
  suggestions,
  strength,
  notes,
  today,
}: {
  kpis: Kpi[];
  suggestions: Shown[];
  strength: Record<LiftKey, { name: string; change: number }[]>;
  notes: Note[];
  today: string;
}) {
  const router = useRouter();
  const dismissed = usePref("inboxSnoozed");
  const [lift, setLift] = useState<LiftKey>("squat");
  const [pending, start] = useTransition();
  const shown = suggestions.filter((s) => !isSnoozed(dismissed, `insight-${s.key}`, today));
  const dismiss = (s: Shown) => setPref("inboxSnoozed", { ...liveSnoozes(dismissed, today), [`insight-${s.key}`]: FOREVER });
  const apply = (s: Shown) =>
    start(async () => {
      const patch = s.max!.lift === "squat" ? { squat1RM: s.max!.value } : s.max!.lift === "bench" ? { bench1RM: s.max!.value } : { dead1RM: s.max!.value };
      // The max the targets use: the phase's own when it has one, else the athlete's.
      if (s.onPhase && s.phaseId) await updateBlockMaxes(s.phaseId, patch);
      else await updateAthlete(s.athleteId, patch);
      router.refresh();
    });

  const commands = useMemo<Command[]>(
    () =>
      LIFT_ORDER.map((l) => ({
        id: `insights-lift-${l}`,
        group: "Overview",
        title: t("Insights: chart the {lift} e1RM", { lift: t(LIFT_LABEL[l]) }),
        keywords: "insights strength e1rm chart",
        run: () => setLift(l),
      })),
    [],
  );
  useCommands("overview-insights", commands);

  const bars = strength[lift];
  const scale = Math.max(5, ...bars.map((b) => Math.abs(b.change)));

  return (
    <div className="mt-5 flex flex-col gap-5">
      <section aria-label={t("This week")} className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
        {kpis.map((k) => (
          <div key={k.label} className={`${card} flex flex-col gap-1.5 px-4 py-3.5`}>
            <span className="text-[10.5px] tracking-[0.14em] text-muted-2">{k.label}</span>
            <span className="flex items-end justify-between gap-2">
              <span className="text-[24px] font-semibold tabular-nums">{k.value}</span>
              <Spark values={k.values} tone={TONE[k.tone]} />
            </span>
            <span className={`text-[11.5px] ${TONE[k.tone]}`}>{k.delta}</span>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <section aria-label={t("Suggestions")} className="flex min-w-0 flex-col gap-2.5">
          <h2 className="text-[11px] font-medium tracking-[0.16em] text-muted-2">
            {t("SUGGESTIONS")} · {shown.length}
            <span className="ml-2 tracking-normal">{t("worked out from logs and check-ins")}</span>
          </h2>
          {shown.length === 0 && <p className={`${card} px-4 py-6 text-center text-[12px] text-muted-2`}>{t("Nothing stands out this week.")}</p>}
          {shown.map((s) => (
            <article key={s.key} className={`${card} flex flex-col gap-2.5 px-4 py-3.5`}>
              <div className="flex items-baseline gap-2.5">
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[s.tone]}`} />
                <span className="flex-1 text-[14px] font-semibold leading-snug">{s.title}</span>
              </div>
              <p className="ml-[18px] text-[12.5px] leading-relaxed text-muted">{s.why}</p>
              <div className="ml-[18px] flex flex-wrap gap-1.5">
                {s.max ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => apply(s)}
                    className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {t("Use {n} {u}", { n: s.max.value, u: s.unit })}
                  </button>
                ) : (
                  <Link href={s.href} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
                    {t("Open programming")}
                  </Link>
                )}
                {s.max && (
                  <Link href={s.href} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent">
                    {t("See the sets")}
                  </Link>
                )}
                <button type="button" onClick={() => dismiss(s)} className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-2 hover:text-foreground">
                  {t("Dismiss")}
                </button>
              </div>
            </article>
          ))}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label={t("e1RM change")} className={`${card} flex flex-col gap-3 p-4`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-medium tracking-[0.16em] text-muted-2">{t("e1RM, LAST 4 WEEKS")}</h2>
              <div role="tablist" aria-label={t("Lift")} className="flex rounded-lg border border-border p-0.5 text-[11.5px]">
                {LIFT_ORDER.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="tab"
                    aria-selected={lift === l}
                    onClick={() => setLift(l)}
                    className={`rounded-md px-2.5 py-0.5 ${lift === l ? "bg-surface-3 text-foreground" : "text-muted hover:text-foreground"}`}
                  >
                    {t(LIFT_LABEL[l])}
                  </button>
                ))}
              </div>
            </div>
            {bars.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-muted-2">{t("Not enough logged to compare yet.")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {bars.map((b) => (
                  <li key={b.name} className="grid grid-cols-[96px_1fr_1fr_52px] items-center text-[12px]">
                    <span className="truncate text-muted">{b.name}</span>
                    <span className="flex h-3 justify-end border-r border-border">
                      {b.change < 0 && <span className="rounded-l-[3px] bg-miss" style={{ width: `${(Math.abs(b.change) / scale) * 100}%` }} />}
                    </span>
                    <span className="flex h-3">
                      {b.change > 0 && <span className="rounded-r-[3px] bg-ok" style={{ width: `${(b.change / scale) * 100}%` }} />}
                    </span>
                    <span className={`text-right tabular-nums ${b.change < 0 ? "text-miss" : "text-muted"}`}>
                      {b.change > 0 ? "+" : ""}
                      {b.change}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-2">{t("Best estimate of the last 4 weeks against the 4 before.")}</p>
          </section>

          <section aria-label={t("From check-ins")} className={`${card} flex flex-col gap-2.5 p-4`}>
            <h2 className="text-[11px] font-medium tracking-[0.16em] text-muted-2">{t("FROM CHECK-INS THIS WEEK")}</h2>
            {notes.length === 0 && <p className="text-[12px] text-muted-2">{t("No notes written this week.")}</p>}
            {notes.map((n, i) => (
              <blockquote key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed">
                “{n.text}”
                <span className="mt-0.5 block text-[11px] text-muted-2">
                  {n.athlete} · {formatDate(n.day)}
                </span>
              </blockquote>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
