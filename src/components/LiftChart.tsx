"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { LIFT_COLOR, type LiftKey, type LiftSeries } from "@/lib/progress";
import { formatDate as formatShortDate } from "@/lib/dates";
import { t } from "@/lib/i18n";

const W = 960;
const H = 240;
const PAD = { top: 16, right: 92, bottom: 30, left: 44 };
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };

type Mode = "prescribed" | "estimated";

const MODE_LABEL: Record<Mode, string> = {
  prescribed: "Top prescribed set",
  estimated: "Estimated 1RM from logged work",
};

/**
 * Every program's main lifts on one time axis. One y-scale only — the three lifts are
 * the same measure in the same unit, which is exactly when sharing an axis is honest.
 */
export function LiftChart({
  series,
  unit,
  mode,
  onMode,
  title = "ACROSS PROGRAMS",
  hidden: hiddenFromProps,
  onToggleLift,
  controls,
}: {
  series: Record<Mode, LiftSeries[]>;
  unit: string;
  mode: Mode;
  onMode: (mode: Mode) => void;
  title?: string;
  /** Lifts switched off, when the caller keeps track of them. */
  hidden?: Set<LiftKey>;
  onToggleLift?: (lift: LiftKey) => void;
  /** More controls beside the mode switch, such as a date range. */
  controls?: ReactNode;
}) {
  const active = series[mode];
  const [ownHidden, setHidden] = useState<Set<LiftKey>>(new Set());
  const hidden = hiddenFromProps ?? ownHidden;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const shown = active.filter((s) => !hidden.has(s.lift) && s.points.length > 0);

  const scale = useMemo(() => {
    const all = shown.flatMap((s) => s.points);
    if (all.length === 0) return null;

    const times = all.map((p) => p.t);
    const values = all.map((p) => p.value);
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // A little headroom, and a floor that is never zero: these are near-max loads, and
    // a zero baseline would squash every difference that matters into one flat band.
    const pad = Math.max(5, (hi - lo) * 0.15);

    const x = (t: number) => (t1 === t0 ? PLOT.w / 2 : ((t - t0) / (t1 - t0)) * PLOT.w);
    const y = (v: number) => PLOT.h - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * PLOT.h;
    return { x, y, t0, t1, lo: lo - pad, hi: hi + pad };
  }, [shown]);

  /** Distinct week starts, so the crosshair snaps to a column rather than a pixel. */
  const columns = useMemo(
    () => [...new Set(active.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b),
    [active],
  );

  const hoveredAt = hover === null ? null : columns[hover];

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!scale || columns.length === 0) return;
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;

    const localX = ((e.clientX - box.left) / box.width) * W - PAD.left;
    let nearest = 0;
    for (let i = 1; i < columns.length; i++) {
      if (Math.abs(scale.x(columns[i]) - localX) < Math.abs(scale.x(columns[nearest]) - localX)) {
        nearest = i;
      }
    }
    setHover(nearest);
  }

  const ticks = useMemo(() => {
    if (!scale) return [];
    const step = niceStep((scale.hi - scale.lo) / 4);
    const first = Math.ceil(scale.lo / step) * step;
    const out: number[] = [];
    for (let v = first; v <= scale.hi; v += step) out.push(Math.round(v * 10) / 10);
    return out;
  }, [scale]);

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t(title)}</h2>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {controls}
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                m === mode
                  ? "border-accent/50 bg-surface-2 text-foreground"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {t(MODE_LABEL[m])}
            </button>
          ))}
        </div>
      </div>

      {/* Legend: identity is never carried by colour alone. */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {active.map((s) => {
          const off = hidden.has(s.lift);
          return (
            <button
              key={s.lift}
              type="button"
              onClick={() =>
                onToggleLift
                  ? onToggleLift(s.lift)
                  : setHidden((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.lift)) next.delete(s.lift);
                      else next.add(s.lift);
                      return next;
                    })
              }
              className={`flex items-center gap-1.5 text-[11px] ${
                off ? "text-muted-2 line-through" : "text-muted"
              }`}
            >
              <span
                aria-hidden
                className="inline-block h-[3px] w-4 rounded-full"
                style={{ background: off ? "var(--muted-2)" : LIFT_COLOR[s.lift] }}
              />
              {t(s.label)}
              {s.points.length === 0 && <span className="text-muted-2">{t("· no data")}</span>}
            </button>
          );
        })}
      </div>

      {scale === null ? (
        <div className="mt-3 rounded-xl border border-dashed border-border px-6 py-10 text-center text-[12px] text-muted-2">
          {mode === "estimated"
            ? t("Nothing logged on a main lift yet.")
            : t("No main lifts programmed yet.")}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-border bg-surface p-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ height: H }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={t("{mode} per lift, across every program", { mode: t(MODE_LABEL[mode]) })}
          >
            <g transform={`translate(${PAD.left},${PAD.top})`}>
              {ticks.map((v) => (
                <g key={v}>
                  <line
                    x1={0}
                    x2={PLOT.w}
                    y1={scale.y(v)}
                    y2={scale.y(v)}
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                  <text
                    x={-8}
                    y={scale.y(v)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="var(--muted-2)"
                    fontSize={10}
                  >
                    {v}
                  </text>
                </g>
              ))}

              {hoveredAt !== null && (
                <line
                  x1={scale.x(hoveredAt)}
                  x2={scale.x(hoveredAt)}
                  y1={0}
                  y2={PLOT.h}
                  stroke="var(--muted-2)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              )}

              {shown.map((s) => (
                <g key={s.lift}>
                  <path
                    d={path(s, scale)}
                    fill="none"
                    stroke={LIFT_COLOR[s.lift]}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {s.points.map((p) => (
                    <circle
                      key={`${p.t}-${p.block}-${p.week}`}
                      cx={scale.x(p.t)}
                      cy={scale.y(p.value)}
                      r={hoveredAt === p.t ? 5 : 3}
                      fill={LIFT_COLOR[s.lift]}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  ))}

                  {/* Direct label at the end of the line, so the legend is a backup. */}
                  <text
                    x={scale.x(s.points[s.points.length - 1].t) + 10}
                    y={scale.y(s.points[s.points.length - 1].value)}
                    dominantBaseline="middle"
                    fill="var(--muted)"
                    fontSize={11}
                  >
                    {t(s.label)} {s.points[s.points.length - 1].value}
                  </text>
                </g>
              ))}

              <text x={0} y={PLOT.h + 20} fill="var(--muted-2)" fontSize={10}>
                {formatDate(scale.t0)}
              </text>
              <text
                x={PLOT.w}
                y={PLOT.h + 20}
                textAnchor="end"
                fill="var(--muted-2)"
                fontSize={10}
              >
                {formatDate(scale.t1)}
              </text>
            </g>
          </svg>

          {hoveredAt !== null && (
            <Tooltip at={hoveredAt} series={shown} unit={unit} />
          )}
        </div>
      )}

      {scale !== null && (
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-[11px] text-muted hover:text-foreground">
            <span className="group-open:hidden">{t("Show numbers")}</span>
            <span className="hidden group-open:inline">{t("Hide numbers")}</span>
          </summary>
          <Table series={shown} unit={unit} />
        </details>
      )}
    </section>
  );
}

function Tooltip({
  at,
  series,
  unit,
}: {
  at: number;
  series: LiftSeries[];
  unit: string;
}) {
  const rows = series
    .map((s) => ({ s, p: s.points.find((p) => p.t === at) }))
    .filter((r) => r.p !== undefined);
  if (rows.length === 0) return null;

  const first = rows[0].p!;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-[11px]">
      <span className="text-muted-2">
        {formatDate(at)} · {first.block} · week {first.week}
      </span>
      {rows.map(({ s, p }) => (
        <span key={s.lift} className="flex items-center gap-1.5 text-muted">
          <span
            aria-hidden
            className="inline-block size-2 rounded-full"
            style={{ background: LIFT_COLOR[s.lift] }}
          />
          {s.label}
          <span className="text-foreground">
            {p!.value} {unit}
          </span>
        </span>
      ))}
    </div>
  );
}

function Table({ series, unit }: { series: LiftSeries[]; unit: string }) {
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);

  return (
    <div className="mt-2 max-h-[320px] overflow-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-surface-2 text-[11px] tracking-[0.12em] text-muted-2">
          <tr>
            <th className="px-3 py-2">{t("WEEK OF")}</th>
            <th className="px-3 py-2">{t("PROGRAM")}</th>
            {series.map((s) => (
              <th key={s.lift} className="px-3 py-2 text-right">
                {t(s.label).toUpperCase()} ({unit})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((t) => {
            const context = series.flatMap((s) => s.points).find((p) => p.t === t)!;
            return (
              <tr key={t} className="border-t border-border/60">
                <td className="px-3 py-1.5 text-muted">{formatDate(t)}</td>
                <td className="px-3 py-1.5 text-muted-2">
                  {context.block} · wk {context.week}
                </td>
                {series.map((s) => {
                  const point = s.points.find((p) => p.t === t);
                  return (
                    <td key={s.lift} className="px-3 py-1.5 text-right">
                      {point ? point.value : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function path(series: LiftSeries, scale: { x: (t: number) => number; y: (v: number) => number }) {
  return series.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${scale.x(p.t).toFixed(1)},${scale.y(p.value).toFixed(1)}`)
    .join(" ");
}

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (pow * factor >= raw) return pow * factor;
  }
  return pow * 10;
}

function formatDate(t: number) {
  return formatShortDate(new Date(t), true);
}
