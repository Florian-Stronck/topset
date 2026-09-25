"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";

/**
 * Small SVG charts for Tracking, drawn the way `LiftChart` is: one viewBox that scales to
 * the width, muted grid lines, a legend that switches series off, and a hover readout under
 * the plot rather than a floating tooltip. Categories run along x (weeks, days).
 */

const FALLBACK_W = 960;
const PAD = { top: 12, right: 16, bottom: 26, left: 44 };

export type Series = { key: string; label: string; color: string };

export function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1e-9, raw)));
  for (const factor of [1, 2, 2.5, 5, 10]) if (pow * factor >= raw) return pow * factor;
  return pow * 10;
}

function ticksOf(lo: number, hi: number, count = 4): number[] {
  const step = niceStep((hi - lo) / count || 1);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** A row of toggles naming each series by its colour; a struck-through one is hidden. */
export function Legend({
  series,
  hidden,
  onToggle,
}: {
  series: Series[];
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {series.map((s) => {
        const off = hidden?.has(s.key) ?? false;
        const body = (
          <>
            <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: off ? "var(--muted-2)" : s.color }} />
            {s.label}
          </>
        );
        return onToggle ? (
          <button
            key={s.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(s.key)}
            className={`flex items-center gap-1.5 text-[11px] ${off ? "text-muted-2 line-through" : "text-muted hover:text-foreground"}`}
          >
            {body}
          </button>
        ) : (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-muted">
            {body}
          </span>
        );
      })}
    </div>
  );
}

/** A card with a title, controls on the right, and the chart. */
export function ChartCard({ title, note, controls, children }: { title: string; note?: string; controls?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-[11px] tracking-[0.16em] text-muted-2">{title}</h3>
        {note && <span className="text-[11px] text-muted-2">{note}</span>}
        {controls && <div className="ml-auto flex flex-wrap items-center gap-1.5">{controls}</div>}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A compact segmented control, for a chart's own options. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-full border border-border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-2.5 py-0.5 text-[11px] ${o.value === value ? "bg-surface-3 text-foreground" : "text-muted-2 hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The width a chart has to fill, so the drawing is 1:1 with the screen and text stays its size. */
function useWidth() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_W);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { box, width };
}

function useHover(count: number, x: (i: number) => number, W: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || count === 0) return;
    const local = ((e.clientX - box.left) / box.width) * W - PAD.left;
    let best = 0;
    for (let i = 1; i < count; i++) if (Math.abs(x(i) - local) < Math.abs(x(best) - local)) best = i;
    setHover(best);
  };
  return { ref, hover, onMove, onLeave: () => setHover(null) };
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center text-[12px] text-muted-2">{text}</div>;
}

/** Stacked bars, one per category. */
export function BarChart({
  categories,
  series,
  values,
  height = 180,
  format = (v) => String(v),
  label,
  empty,
  notes,
  max: fixedMax,
}: {
  categories: string[];
  series: Series[];
  /** Per category, series key → value. */
  values: Record<string, number>[];
  height?: number;
  format?: (v: number) => string;
  label: string;
  empty: string;
  /** A short word over each bar, such as the missed sessions that week. */
  notes?: (string | null)[];
  max?: number;
}) {
  const { box, width: W } = useWidth();
  const plot = { w: W - PAD.left - PAD.right, h: height - PAD.top - PAD.bottom };
  const totals = values.map((v) => series.reduce((n, s) => n + (v[s.key] ?? 0), 0));
  const max = fixedMax ?? Math.max(0, ...totals);
  const band = plot.w / Math.max(1, categories.length);
  const x = (i: number) => band * i + band / 2;
  const { ref, hover, onMove, onLeave } = useHover(categories.length, x, W);
  if (max === 0 || categories.length === 0) return <div ref={box}><Empty text={empty} /></div>;
  const y = (v: number) => plot.h - (v / max) * plot.h;
  const barW = Math.min(56, band * 0.62);

  return (
    <div ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={onLeave}>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {ticksOf(0, max).map((v) => (
            <g key={v}>
              <line x1={0} x2={plot.w} y1={y(v)} y2={y(v)} stroke="var(--border)" />
              <text x={-8} y={y(v)} textAnchor="end" dominantBaseline="middle" fill="var(--muted-2)" fontSize={10}>
                {format(v)}
              </text>
            </g>
          ))}
          {categories.map((c, i) => {
            let base = 0;
            return (
              <g key={c} opacity={hover === null || hover === i ? 1 : 0.55}>
                {series.map((s) => {
                  const v = values[i]?.[s.key] ?? 0;
                  if (v <= 0) return null;
                  const top = base + v;
                  const rect = <rect key={s.key} x={x(i) - barW / 2} y={y(top)} width={barW} height={Math.max(1, y(base) - y(top))} fill={s.color} />;
                  base = top;
                  return rect;
                })}
                {notes?.[i] && (
                  <text x={x(i)} y={y(totals[i]) - 5} textAnchor="middle" fill="var(--muted)" fontSize={10}>
                    {notes[i]}
                  </text>
                )}
                <text x={x(i)} y={plot.h + 17} textAnchor="middle" fill="var(--muted-2)" fontSize={10}>
                  {c}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <Readout>
        {hover !== null && (
          <>
            <span className="text-muted-2">{categories[hover]}</span>
            {series.map((s) =>
              (values[hover]?.[s.key] ?? 0) > 0 ? (
                <span key={s.key} className="flex items-center gap-1.5 text-muted">
                  <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                  {s.label} <span className="text-foreground">{format(values[hover][s.key])}</span>
                </span>
              ) : null,
            )}
            {series.length > 1 && <span className="text-muted-2">{t("total")} <span className="text-foreground">{format(totals[hover])}</span></span>}
          </>
        )}
      </Readout>
    </div>
  );
}

export type LineSeries = Series & {
  values: (number | null)[];
  dashed?: boolean;
  /** Draw straight across missing values, for a measure only some days have. */
  connect?: boolean;
};

/**
 * Lines over categories, gaps where a value is missing. `bars` draws one more series as
 * bars behind the lines on their own 0–max scale, for putting two measures side by side.
 */
export function LineChart({
  categories,
  series,
  height = 180,
  format = (v) => String(v),
  label,
  empty,
  domain,
  zero,
  bars,
  xLabelEvery = 1,
}: {
  categories: string[];
  series: LineSeries[];
  height?: number;
  format?: (v: number) => string;
  label: string;
  empty: string;
  /** Fixed y range; else it fits the values. */
  domain?: [number, number];
  /** A reference line, such as "as planned". */
  zero?: { value: number; label: string };
  bars?: { label: string; values: (number | null)[]; max: number; color: (v: number) => string; format?: (v: number) => string; faint?: boolean };
  xLabelEvery?: number;
}) {
  const { box, width: W } = useWidth();
  const plot = { w: W - PAD.left - PAD.right, h: height - PAD.top - PAD.bottom };
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const band = plot.w / Math.max(1, categories.length);
  const x = (i: number) => band * i + band / 2;
  const { ref, hover, onMove, onLeave } = useHover(categories.length, x, W);
  const anyBar = bars?.values.some((v) => v !== null) ?? false;
  if ((all.length === 0 && !anyBar) || categories.length === 0) return <div ref={box}><Empty text={empty} /></div>;

  let lo = domain?.[0] ?? Math.min(...all, zero?.value ?? Infinity);
  let hi = domain?.[1] ?? Math.max(...all, zero?.value ?? -Infinity);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
  if (!domain) {
    const pad = Math.max(0.5, (hi - lo) * 0.15);
    lo -= pad;
    hi += pad;
  }
  const y = (v: number) => plot.h - ((v - lo) / (hi - lo || 1)) * plot.h;
  const barY = (v: number) => plot.h - (v / (bars?.max || 1)) * plot.h;
  const barW = Math.min(22, band * 0.6);

  const path = (values: (number | null)[], connect = false) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        if (!connect) pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };

  return (
    <div ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={onLeave}>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {ticksOf(lo, hi).map((v) => (
            <g key={v}>
              <line x1={0} x2={plot.w} y1={y(v)} y2={y(v)} stroke="var(--border)" />
              <text x={-8} y={y(v)} textAnchor="end" dominantBaseline="middle" fill="var(--muted-2)" fontSize={10}>
                {format(v)}
              </text>
            </g>
          ))}
          {bars?.values.map((v, i) =>
            v === null ? null : (
              <rect key={i} x={x(i) - barW / 2} y={barY(v)} width={barW} height={Math.max(1, plot.h - barY(v))} rx={2} fill={bars.color(v)} opacity={(hover === null || hover === i ? 0.85 : 0.45) * (bars.faint ? 0.4 : 1)} />
            ),
          )}
          {zero && (
            <g>
              <line x1={0} x2={plot.w} y1={y(zero.value)} y2={y(zero.value)} stroke="var(--muted-2)" strokeDasharray="4 4" />
              <text x={plot.w} y={y(zero.value) - 4} textAnchor="end" fill="var(--muted-2)" fontSize={10}>
                {zero.label}
              </text>
            </g>
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={plot.h} stroke="var(--muted-2)" strokeDasharray="3 3" />}
          {series.map((s) => (
            <g key={s.key}>
              <path d={path(s.values, s.connect)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "6 5" : undefined} />
              {s.values.map((v, i) =>
                v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 2.5} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} />,
              )}
            </g>
          ))}
          {categories.map((c, i) =>
            i % xLabelEvery === 0 || i === categories.length - 1 ? (
              <text key={i} x={x(i)} y={plot.h + 17} textAnchor="middle" fill="var(--muted-2)" fontSize={10}>
                {c}
              </text>
            ) : null,
          )}
        </g>
      </svg>
      <Readout>
        {hover !== null && (
          <>
            <span className="text-muted-2">{categories[hover]}</span>
            {bars && bars.values[hover] !== null && (
              <span className="flex items-center gap-1.5 text-muted">
                <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: bars.color(bars.values[hover] as number) }} />
                {bars.label} <span className="text-foreground">{(bars.format ?? format)(bars.values[hover] as number)}</span>
              </span>
            )}
            {series.map((s) =>
              s.values[hover] === null ? null : (
                <span key={s.key} className="flex items-center gap-1.5 text-muted">
                  <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                  {s.label} <span className="text-foreground">{format(s.values[hover] as number)}</span>
                </span>
              ),
            )}
          </>
        )}
      </Readout>
    </div>
  );
}

/** The line under a chart that reads out the hovered column; holds its height when empty. */
function Readout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[22px] flex-wrap items-center gap-3 border-t border-border/60 pt-1.5 text-[11px]">{children}</div>;
}
