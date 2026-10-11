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
  xLabelEvery = 1,
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
  xLabelEvery?: number;
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
                {i % xLabelEvery === 0 && (
                  <text x={x(i)} y={plot.h + 17} textAnchor="middle" fill="var(--muted-2)" fontSize={10}>
                    {c}
                  </text>
                )}
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
            // The last date too, unless it would sit on top of the one before it.
            i % xLabelEvery === 0 || (i === categories.length - 1 && i % xLabelEvery >= xLabelEvery / 2) ? (
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

// --- Combo and pie, for the charts coaches build themselves --------------------------------

export type ComboType = "line" | "bar" | "area" | "dots";
/** A straight line by index: y = slope × i + intercept. */
export type Trend = { slope: number; intercept: number };
export type ComboSeries = Series & { values: (number | null)[]; type: ComboType; axis: "left" | "right"; dashed?: boolean; trend?: Trend | null };
type Domain = { min?: number | null; max?: number | null };

/** 12345 → "12.3k", 3.14159 → "3.1": short enough for an axis or a label over a bar. */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${Math.round(v / 1e5) / 10}M`;
  if (a >= 1e4) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v * 10) / 10);
}

/**
 * Any mix of bars, lines, areas and dots over the same dates, each on the left or the right
 * axis — the spreadsheet combo chart. Bars sit side by side, or stacked per axis.
 */
export function ComboChart({
  categories,
  series,
  height = 200,
  label,
  empty,
  stack = false,
  left,
  right,
  refLine,
  labels = false,
  xLabelEvery = 1,
}: {
  categories: string[];
  series: ComboSeries[];
  height?: number;
  label: string;
  empty: string;
  stack?: boolean;
  left?: Domain;
  right?: Domain;
  refLine?: { value: number; label: string } | null;
  /** The value over every bar and point. */
  labels?: boolean;
  xLabelEvery?: number;
}) {
  const { box, width: W } = useWidth();
  const hasRight = series.some((s) => s.axis === "right");
  const hasLeft = series.some((s) => s.axis === "left");
  const padRight = hasRight ? PAD.left : PAD.right;
  const plot = { w: W - PAD.left - padRight, h: height - PAD.top - PAD.bottom };
  const band = plot.w / Math.max(1, categories.length);
  const x = (i: number) => band * i + band / 2;
  const { ref, hover, onMove, onLeave } = useHover(categories.length, x, W);
  const any = series.some((s) => s.values.some((v) => v !== null));
  if (!any || categories.length === 0) return <div ref={box}><Empty text={empty} /></div>;

  const bars = series.filter((s) => s.type === "bar");
  // Where each bar series stands in its band: one slot per series, or one per axis when stacked.
  const slots = stack ? [...new Set(bars.map((s) => s.axis))] : bars.map((s) => s.key);
  const slotOf = (s: ComboSeries) => slots.indexOf(stack ? s.axis : s.key);
  const groupW = Math.min(56, band * 0.72);
  const barW = groupW / Math.max(1, slots.length);

  // Each axis fits what is drawn on it; bars and areas stand on zero.
  const scale = (axis: "left" | "right", fixed: Domain | undefined) => {
    const own = series.filter((s) => s.axis === axis);
    const values: number[] = [];
    for (const s of own) if (!(stack && s.type === "bar")) for (const v of s.values) if (v !== null) values.push(v);
    for (const s of own) {
      const ends = trendEnds(s);
      if (ends) values.push(ends[0][1], ends[1][1]);
    }
    if (stack) {
      const stacked = own.filter((s) => s.type === "bar");
      categories.forEach((_, i) => {
        values.push(
          stacked.reduce((n, s) => n + Math.max(0, s.values[i] ?? 0), 0),
          stacked.reduce((n, s) => n + Math.min(0, s.values[i] ?? 0), 0),
        );
      });
    }
    if (axis === "left" && refLine) values.push(refLine.value);
    const grounded = own.some((s) => s.type === "bar" || s.type === "area");
    let lo = values.length ? Math.min(...values) : 0;
    let hi = values.length ? Math.max(...values) : 1;
    if (grounded) {
      lo = Math.min(0, lo);
      hi = Math.max(0, hi);
      hi += (hi - lo) * 0.08;
    } else {
      const pad = Math.max(0.5, (hi - lo) * 0.15);
      lo -= pad;
      hi += pad;
    }
    lo = fixed?.min ?? lo;
    hi = fixed?.max ?? hi;
    if (hi <= lo) hi = lo + 1;
    return { lo, hi, y: (v: number) => plot.h - ((v - lo) / (hi - lo)) * plot.h };
  };
  const axes = { left: scale("left", left), right: scale("right", right) };

  const path = (s: ComboSeries) => {
    const { y } = axes[s.axis];
    let d = "";
    s.values.forEach((v, i) => {
      if (v !== null) d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    });
    return d;
  };
  const area = (s: ComboSeries) => {
    const { y, lo, hi } = axes[s.axis];
    const base = y(Math.min(hi, Math.max(lo, 0)));
    const pts = s.values.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)]]));
    if (pts.length === 0) return "";
    return `M${pts[0][0]},${base} ${pts.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(" ")} L${pts[pts.length - 1][0]},${base} Z`;
  };

  // Stacked bars build up from zero per axis, category by category.
  const stacks = categories.map(() => ({ left: { up: 0, down: 0 }, right: { up: 0, down: 0 } }));

  return (
    <div ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={onLeave}>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {(hasLeft ? ticksOf(axes.left.lo, axes.left.hi) : []).map((v) => (
            <g key={`l${v}`}>
              <line x1={0} x2={plot.w} y1={axes.left.y(v)} y2={axes.left.y(v)} stroke="var(--border)" />
              <text x={-8} y={axes.left.y(v)} textAnchor="end" dominantBaseline="middle" fill="var(--muted-2)" fontSize={10}>
                {compact(v)}
              </text>
            </g>
          ))}
          {(hasRight ? ticksOf(axes.right.lo, axes.right.hi) : []).map((v) => (
            <g key={`r${v}`}>
              {!hasLeft && <line x1={0} x2={plot.w} y1={axes.right.y(v)} y2={axes.right.y(v)} stroke="var(--border)" />}
              <text x={plot.w + 8} y={axes.right.y(v)} dominantBaseline="middle" fill="var(--muted-2)" fontSize={10}>
                {compact(v)}
              </text>
            </g>
          ))}

          {bars.map((s) =>
            s.values.map((v, i) => {
              if (v === null || v === 0) return null;
              const { y } = axes[s.axis];
              let from = 0;
              if (stack) {
                const st = stacks[i][s.axis];
                from = v > 0 ? st.up : st.down;
                if (v > 0) st.up += v;
                else st.down += v;
              }
              const top = y(Math.max(from, from + v));
              const bottom = y(Math.min(from, from + v));
              const bx = x(i) - groupW / 2 + slotOf(s) * barW;
              return (
                <g key={`${s.key}-${i}`} opacity={hover === null || hover === i ? 0.9 : 0.5}>
                  <rect x={bx + 0.5} y={top} width={Math.max(1, barW - 1)} height={Math.max(1, bottom - top)} rx={2} fill={s.color} />
                  {labels && (
                    <text x={bx + barW / 2} y={top - 4} textAnchor="middle" fill="var(--muted)" fontSize={9}>
                      {compact(v)}
                    </text>
                  )}
                </g>
              );
            }),
          )}

          {refLine && hasLeft && (
            <g>
              <line x1={0} x2={plot.w} y1={axes.left.y(refLine.value)} y2={axes.left.y(refLine.value)} stroke="var(--muted-2)" strokeDasharray="4 4" />
              <text x={plot.w} y={axes.left.y(refLine.value) - 4} textAnchor="end" fill="var(--muted-2)" fontSize={10}>
                {refLine.label}
              </text>
            </g>
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={plot.h} stroke="var(--muted-2)" strokeDasharray="3 3" />}

          {series.map((s) => {
            const ends = trendEnds(s);
            if (!ends) return null;
            const { y } = axes[s.axis];
            return (
              <line
                key={`trend-${s.key}`}
                x1={x(ends[0][0])}
                x2={x(ends[1][0])}
                y1={y(ends[0][1])}
                y2={y(ends[1][1])}
                stroke={s.color}
                strokeWidth={1.5}
                strokeDasharray="2 4"
                strokeLinecap="round"
                opacity={0.9}
              />
            );
          })}

          {series
            .filter((s) => s.type !== "bar")
            .map((s) => {
              const { y } = axes[s.axis];
              return (
                <g key={s.key}>
                  {s.type === "area" && <path d={area(s)} fill={s.color} opacity={0.18} />}
                  {s.type !== "dots" && (
                    <path d={path(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "6 5" : undefined} />
                  )}
                  {s.values.map((v, i) =>
                    v === null ? null : (
                      <g key={i}>
                        <circle cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : s.type === "dots" ? 3.5 : 2.5} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} />
                        {labels && (
                          <text x={x(i)} y={y(v) - 7} textAnchor="middle" fill="var(--muted)" fontSize={9}>
                            {compact(v)}
                          </text>
                        )}
                      </g>
                    ),
                  )}
                </g>
              );
            })}

          {categories.map((c, i) =>
            i % xLabelEvery === 0 || (i === categories.length - 1 && i % xLabelEvery >= xLabelEvery / 2) ? (
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
            {series.map((s) =>
              s.values[hover] === null ? null : (
                <span key={s.key} className="flex items-center gap-1.5 text-muted">
                  <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                  {s.label} <span className="text-foreground">{compact(s.values[hover] as number)}</span>
                </span>
              ),
            )}
          </>
        )}
      </Readout>
    </div>
  );
}

/** Where a series' trend line starts and ends: across the stretch the series has values. */
function trendEnds(s: ComboSeries): [[number, number], [number, number]] | null {
  if (!s.trend) return null;
  const first = s.values.findIndex((v) => v !== null);
  const last = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
  if (first < 0 || last <= first) return null;
  const at = (i: number) => s.trend!.slope * i + s.trend!.intercept;
  return [[first, at(first)], [last, at(last)]];
}

export type ScatterSeries = Series & { points: { x: number; y: number; tag: string }[]; trend?: { slope: number; intercept: number; r2: number } | null };

/**
 * One measure against another: a dot per day or week where both were logged, with the
 * straight line that fits them best — whether more sleep goes with lower RPE, say.
 */
export function ScatterChart({
  series,
  xLabel,
  height = 220,
  label,
  empty,
}: {
  series: ScatterSeries[];
  xLabel: string;
  height?: number;
  label: string;
  empty: string;
}) {
  const { box, width: W } = useWidth();
  const [hover, setHover] = useState<{ key: string; i: number } | null>(null);
  const pad = { ...PAD, bottom: PAD.bottom + 14 };
  const plot = { w: W - pad.left - pad.right, h: height - pad.top - pad.bottom };
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return <div ref={box}><Empty text={empty} /></div>;

  const range = (vs: number[]) => {
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    const padding = Math.max(0.5, (hi - lo) * 0.08);
    lo -= padding;
    hi += padding;
    return { lo, hi };
  };
  const xs = range(all.map((p) => p.x));
  const ys = range(all.map((p) => p.y));
  const px = (v: number) => ((v - xs.lo) / (xs.hi - xs.lo)) * plot.w;
  const py = (v: number) => plot.h - ((v - ys.lo) / (ys.hi - ys.lo)) * plot.h;
  const clampY = (v: number) => Math.min(ys.hi, Math.max(ys.lo, v));
  const focus = hover ? series.find((s) => s.key === hover.key) : undefined;
  const point = focus && hover ? focus.points[hover.i] : undefined;

  return (
    <div ref={box}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticksOf(ys.lo, ys.hi).map((v) => (
            <g key={`y${v}`}>
              <line x1={0} x2={plot.w} y1={py(v)} y2={py(v)} stroke="var(--border)" />
              <text x={-8} y={py(v)} textAnchor="end" dominantBaseline="middle" fill="var(--muted-2)" fontSize={10}>
                {compact(v)}
              </text>
            </g>
          ))}
          {ticksOf(xs.lo, xs.hi, 6).map((v) => (
            <g key={`x${v}`}>
              <line x1={px(v)} x2={px(v)} y1={0} y2={plot.h} stroke="var(--border)" opacity={0.5} />
              <text x={px(v)} y={plot.h + 16} textAnchor="middle" fill="var(--muted-2)" fontSize={10}>
                {compact(v)}
              </text>
            </g>
          ))}
          <text x={plot.w / 2} y={plot.h + 32} textAnchor="middle" fill="var(--muted)" fontSize={10}>
            {xLabel}
          </text>
          {series.map((s) =>
            s.trend ? (
              <line
                key={`t-${s.key}`}
                x1={0}
                x2={plot.w}
                y1={py(clampY(s.trend.slope * xs.lo + s.trend.intercept))}
                y2={py(clampY(s.trend.slope * xs.hi + s.trend.intercept))}
                stroke={s.color}
                strokeWidth={1.5}
                strokeDasharray="2 4"
                strokeLinecap="round"
              />
            ) : null,
          )}
          {series.map((s) =>
            s.points.map((p, i) => {
              const on = hover?.key === s.key && hover.i === i;
              return (
                <circle
                  key={`${s.key}-${i}`}
                  cx={px(p.x)}
                  cy={py(p.y)}
                  r={on ? 6 : 4}
                  fill={s.color}
                  fillOpacity={on ? 1 : 0.7}
                  stroke="var(--surface)"
                  strokeWidth={1}
                  onMouseEnter={() => setHover({ key: s.key, i })}
                />
              );
            }),
          )}
        </g>
      </svg>
      <Readout>
        {point && focus ? (
          <>
            <span className="text-muted-2">{point.tag}</span>
            <span className="text-muted">
              {xLabel} <span className="text-foreground">{compact(point.x)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-muted">
              <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: focus.color }} />
              {focus.label} <span className="text-foreground">{compact(point.y)}</span>
            </span>
          </>
        ) : (
          series
            .filter((s) => s.trend)
            .map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-muted">
                <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                {s.label} <span className="text-foreground">r² {Math.round(s.trend!.r2 * 100) / 100}</span>
              </span>
            ))
        )}
      </Readout>
    </div>
  );
}

/** Shares of a whole, as a pie or a ring, with each slice's value and percentage beside it. */
export function PieChart({
  slices,
  donut = false,
  height = 200,
  label,
  empty,
}: {
  slices: (Series & { value: number })[];
  donut?: boolean;
  height?: number;
  label: string;
  empty: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((n, s) => n + s.value, 0);
  if (total <= 0) return <Empty text={empty} />;
  const r = height / 2 - 8;
  const inner = donut ? r * 0.58 : 0;
  const c = height / 2;
  const point = (angle: number, radius: number) => [c + radius * Math.sin(angle), c - radius * Math.cos(angle)];
  const turn = (v: number) => (v / total) * Math.PI * 2;
  const arcs = shown.map((s, i) => {
    const start = turn(shown.slice(0, i).reduce((n, x) => n + x.value, 0));
    const sweep = turn(s.value);
    return { s, start, end: start + sweep, sweep };
  });
  const ring = (R: number, back = false) =>
    `M${c},${c - R} A${R},${R} 0 1 ${back ? 0 : 1} ${c},${c + R} A${R},${R} 0 1 ${back ? 0 : 1} ${c},${c - R} Z`;
  const arc = ({ start, end, sweep }: (typeof arcs)[number], grow: number) => {
    const R = r + grow;
    // A whole circle can't be drawn as one arc.
    if (sweep >= Math.PI * 2 - 1e-6) return inner > 0 ? `${ring(R)} ${ring(inner, true)}` : ring(R);
    const large = sweep > Math.PI ? 1 : 0;
    const [x1, y1] = point(start, R);
    const [x2, y2] = point(end, R);
    if (inner === 0) return `M${c},${c} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`;
    const [x3, y3] = point(end, inner);
    const [x4, y4] = point(start, inner);
    return `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
  };
  const focus = shown.find((s) => s.key === hover);

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox={`0 0 ${height} ${height}`} style={{ width: height, height }} role="img" aria-label={label} className="shrink-0">
        {arcs.map((a) => (
          <path
            key={a.s.key}
            d={arc(a, hover === a.s.key ? 4 : 0)}
            fill={a.s.color}
            fillRule="evenodd"
            stroke="var(--surface)"
            strokeWidth={1.5}
            opacity={hover === null || hover === a.s.key ? 1 : 0.55}
            onMouseEnter={() => setHover(a.s.key)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {donut && (
          <text x={c} y={c} textAnchor="middle" dominantBaseline="middle" fill="var(--foreground)" fontSize={13}>
            {focus ? `${Math.round((focus.value / total) * 100)}%` : compact(total)}
          </text>
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-[11px]">
        {shown.map((s) => (
          <li
            key={s.key}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 ${hover === s.key ? "text-foreground" : "text-muted"}`}
          >
            <span aria-hidden className="inline-block size-2 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="tabular-nums text-foreground">{compact(s.value)}</span>
            <span className="w-9 text-right tabular-nums text-muted-2">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
