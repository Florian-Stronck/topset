"use client";

import { useMemo, useState, useTransition } from "react";
import { addBodyweight, deleteBodyweight } from "@/app/tracking/actions";
import { bodyweightSummary, dailyWeights, projectWeight, rollingAverage, type BodyweightEntry } from "@/lib/bodyweight";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { addDays } from "@/lib/schedule";

const W = 1100;
const H = 170;
const PAD = { top: 10, right: 12, bottom: 20, left: 36 };
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
/** How far back the chart looks. */
const CHART_DAYS = 120;

/**
 * Bodyweight on Tracking: the last few months as dots with the 7-day average through them,
 * the class limit of the next meet as a line, and the entries themselves — the athlete's
 * from their phone, and any the coach adds here.
 */
export function BodyweightPanel({
  athleteId,
  unit,
  today,
  entries: initial,
  meet,
}: {
  athleteId: string;
  unit: string;
  today: string;
  /** Oldest first. */
  entries: BodyweightEntry[];
  meet: { name: string; day: string; weightClass: string | null; limit: number | null } | null;
}) {
  const [entries, setEntries] = useState(initial);
  const [synced, setSynced] = useState(initial);
  const [day, setDay] = useState(today);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // New weigh-ins from the athlete arrive with a refresh.
  if (synced !== initial) {
    setSynced(initial);
    setEntries(initial);
  }

  const daily = useMemo(() => dailyWeights(entries), [entries]);
  const summary = bodyweightSummary(daily, today);
  const limit = meet?.limit ?? null;
  const current = summary.avg7 ?? summary.latest?.weight ?? null;
  const projection = meet ? projectWeight(daily, today, meet.day) : null;

  const weight = Number(draft.replace(",", "."));
  const valid = draft.trim() !== "" && Number.isFinite(weight) && weight > 0;

  function add() {
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const entry = await addBodyweight(athleteId, day, weight);
        setEntries((was) => [...was, entry].sort((a, b) => a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt)));
        setDraft("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function remove(id: string) {
    setEntries((was) => was.filter((e) => e.id !== id));
    startTransition(() => deleteBodyweight(id));
  }

  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("BODYWEIGHT")}</h2>
        {current !== null ? (
          <>
            <span className="text-[18px] font-semibold tabular-nums">
              {current} {unit}
            </span>
            <span className="text-[11px] text-muted-2">
              {summary.avg7 !== null ? t("7-day avg") : t("last weigh-in")}
              {summary.change7 !== null &&
                ` · ${summary.change7 > 0 ? "+" : ""}${summary.change7} ${t("vs the week before")}`}
              {summary.age !== null && summary.age > 0 && ` · ${t("last {n}d ago", { n: summary.age })}`}
            </span>
            {limit !== null && meet && (
              <span className={`text-[11px] ${current > limit ? "text-warn" : "text-muted-2"}`}>
                {current > limit
                  ? t("{n} {u} over the {class} class for {meet}", {
                      n: Math.round((current - limit) * 10) / 10,
                      u: unit,
                      class: meet.weightClass ?? String(limit),
                      meet: meet.name,
                    })
                  : t("{n} {u} under the {class} class for {meet}", {
                      n: Math.round((limit - current) * 10) / 10,
                      u: unit,
                      class: meet.weightClass ?? String(limit),
                      meet: meet.name,
                    })}
              </span>
            )}
            {projection && meet && (
              <span
                className={`text-[11px] ${limit !== null && projection.weight > limit ? "text-warn" : "text-muted-2"}`}
                title={t("A straight line through the last three weeks of weigh-ins, carried to the meet")}
              >
                {t("on this trend {w} {u} at {meet} ({rate}/wk)", {
                  w: projection.weight,
                  u: unit,
                  meet: meet.name,
                  rate: `${projection.perWeek > 0 ? "+" : ""}${projection.perWeek}`,
                })}
              </span>
            )}
          </>
        ) : (
          <span className="text-[12px] text-muted-2">{t("No weigh-ins yet. The athlete logs them on Today in the app, or add one here.")}</span>
        )}
      </div>

      {daily.length > 1 && <Chart daily={daily} limit={limit} today={today} unit={unit} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={day}
          max={today}
          onChange={(e) => setDay(e.target.value || today)}
          className="h-8 rounded-lg border border-border bg-surface-2 px-2 text-[12px] outline-none focus:border-accent"
        />
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={unit}
          aria-label={t("Bodyweight in {u}", { u: unit })}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          className="h-8 w-24 rounded-lg border border-border bg-surface-2 px-2 text-center text-[12px] tabular-nums outline-none placeholder:text-muted-2 focus:border-accent"
        />
        <button
          type="button"
          onClick={add}
          disabled={!valid || pending}
          className="h-8 rounded-lg border border-border px-3 text-[12px] text-muted hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {t("Add weigh-in")}
        </button>
        {error && <span className="text-[11px] text-miss">{error}</span>}
      </div>

      {entries.length > 0 && (
        <ul className="mt-3 max-h-[168px] divide-y divide-border/60 overflow-auto border-t border-border text-[12px]">
          {[...entries].reverse().slice(0, 30).map((e) => (
            <li key={e.id} className="group flex items-center gap-3 py-1.5">
              <span className="w-24 shrink-0 text-muted">{formatDate(e.day, true)}</span>
              <span className="w-20 shrink-0 tabular-nums">
                {e.weight} {unit}
              </span>
              <span className="flex-1 truncate text-[11px] text-muted-2">
                {e.source === "coach" ? t("added by you") : t("from the app")}
                {e.note ? ` · ${e.note}` : ""}
              </span>
              <button
                type="button"
                onClick={() => remove(e.id)}
                title={t("Delete this weigh-in")}
                className="rounded px-1.5 text-muted-2 opacity-40 hover:text-miss focus:opacity-100 group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Chart({ daily, limit, today, unit }: { daily: { day: string; weight: number }[]; limit: number | null; today: string; unit: string }) {
  const from = addDays(today, -CHART_DAYS);
  const points = daily.filter((d) => d.day >= from);
  if (points.length < 2) return null;
  const avg = rollingAverage(daily).filter((d) => d.day >= from);

  const ms = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
  const t0 = ms(points[0].day);
  const t1 = Math.max(ms(points[points.length - 1].day), t0 + 86_400_000);
  const values = [...points.map((p) => p.weight), ...(limit !== null ? [limit] : [])];
  const lo = Math.min(...values) - 1;
  const hi = Math.max(...values) + 1;
  const x = (ymd: string) => ((ms(ymd) - t0) / (t1 - t0)) * PLOT.w;
  const y = (v: number) => PLOT.h - ((v - lo) / (hi - lo)) * PLOT.h;
  const line = avg.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.weight).toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-2 w-full"
      style={{ maxHeight: H }}
      role="img"
      aria-label={t("Bodyweight over the last {n} days, with the 7-day average", { n: CHART_DAYS })}
    >
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {ticks(lo, hi).map((v) => (
          <g key={v}>
            <line x1={0} x2={PLOT.w} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={-6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--muted-2)">
              {v}
            </text>
          </g>
        ))}
        {limit !== null && (
          <g>
            <line x1={0} x2={PLOT.w} y1={y(limit)} y2={y(limit)} stroke="var(--warn)" strokeDasharray="4 3" />
            <text x={PLOT.w} y={y(limit) - 4} textAnchor="end" fontSize={10} fill="var(--warn)">
              {t("class limit {n} {u}", { n: limit, u: unit })}
            </text>
          </g>
        )}
        {points.map((p) => (
          <circle key={p.day} cx={x(p.day)} cy={y(p.weight)} r={2.5} fill="var(--muted)">
            <title>{`${formatDate(p.day)} · ${p.weight} ${unit}`}</title>
          </circle>
        ))}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        <text x={0} y={PLOT.h + 15} fontSize={10} fill="var(--muted-2)">
          {formatDate(points[0].day)}
        </text>
        <text x={PLOT.w} y={PLOT.h + 15} textAnchor="end" fontSize={10} fill="var(--muted-2)">
          {formatDate(points[points.length - 1].day)}
        </text>
      </g>
    </svg>
  );
}

/** Whole-number gridlines, 1, 2 or 5 apart, whichever gives three to six of them. */
function ticks(lo: number, hi: number): number[] {
  const step = [1, 2, 5, 10].find((s) => (hi - lo) / s <= 6) ?? 20;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}
