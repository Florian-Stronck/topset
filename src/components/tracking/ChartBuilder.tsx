"use client";

import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/charts/charts";
import { ChartView } from "@/components/tracking/ChartBoard";
import { newId, normalize, type Preset } from "@/lib/chart-library";
import { t } from "@/lib/i18n";
import { AGGS, METRIC_GROUPS, PALETTE, type Agg, type Metrics } from "@/lib/metrics";
import type { ChartMetric, ChartSpec } from "@/lib/settings";

const RANGES: ChartSpec["range"][] = [7, 14, 28, 56, 84, 182, 365, "phase", "all"];
const MAX_METRICS = 12;

const AGG_LABEL: Record<Agg, string> = { avg: "Average", sum: "Total", max: "Highest", min: "Lowest", last: "Last" };
const TYPES: { value: NonNullable<ChartMetric["type"]>; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "bar", label: "Bars" },
  { value: "area", label: "Area" },
  { value: "dots", label: "Dots" },
];

function rangeLabel(r: ChartSpec["range"]) {
  if (r === "phase") return t("This phase");
  if (r === "all") return t("Everything");
  return r % 7 === 0 && r > 28 ? t("{n} weeks", { n: r / 7 }) : t("{n} days", { n: r });
}

/** A number box that may be left empty, for an axis end. */
function Bound({ value, onChange, label }: { value: number | null | undefined; onChange: (v: number | null) => void; label: string }) {
  return (
    <input
      type="number"
      aria-label={label}
      placeholder={t("auto")}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-20 rounded-lg border border-border bg-surface-2 px-2 py-1 text-[12px] outline-none focus:border-accent"
    />
  );
}

/** Pick a chart from the library, or put one together from any measure; previewed live on the athlete. */
export function ChartBuilder({
  start,
  initial,
  presets,
  metrics,
  today,
  phase,
  onSave,
  onClose,
}: {
  start: "library" | "build";
  initial: ChartSpec | null;
  presets: Preset[];
  metrics: Metrics;
  today: string;
  phase: { from: string; to: string } | null;
  onSave: (spec: ChartSpec) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"library" | "build">(initial ? "build" : start);
  const [picked, setPicked] = useState(presets[0]?.key ?? "");
  const [spec, setSpec] = useState<ChartSpec>(() =>
    initial
      ? normalize(initial)
      : { id: newId(), title: t("New chart"), kind: "combo", by: "week", range: 84, metrics: [{ id: metrics.defs[0]?.id ?? "tonnage", type: "bar", axis: "left" }] },
  );
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fromPreset = (p: Preset): ChartSpec => ({ ...p.spec, id: newId(), title: t(p.title) });
  const preset = presets.find((p) => p.key === picked);
  const shown = mode === "library" ? (preset ? fromPreset(preset) : null) : spec;
  const needle = search.trim().toLowerCase();
  const listed = presets.filter((p) => !needle || t(p.title).toLowerCase().includes(needle) || t(p.note).toLowerCase().includes(needle));

  const set = (patch: Partial<ChartSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const setMetric = (i: number, patch: Partial<ChartMetric>) => set({ metrics: spec.metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const allAs = (type: NonNullable<ChartMetric["type"]>, stack = false) => set({ stack, metrics: spec.metrics.map((m) => ({ ...m, type })) });
  const move = (i: number, j: number) => {
    if (j < 0 || j >= spec.metrics.length) return;
    const next = [...spec.metrics];
    [next[i], next[j]] = [next[j], next[i]];
    set({ metrics: next });
  };
  const groups = useMemo(() => METRIC_GROUPS.map((g) => ({ group: g, defs: metrics.defs.filter((d) => d.group === g) })).filter((g) => g.defs.length > 0), [metrics.defs]);
  const defs = new Map(metrics.defs.map((d) => [d.id, d]));
  const pie = spec.kind === "pie" || spec.kind === "donut";
  const scatter = spec.kind === "scatter";
  const hasRight = spec.metrics.some((m) => m.axis === "right");

  const field = "rounded-lg border border-border bg-surface-2 px-2 py-1 text-[12px] outline-none focus:border-accent";
  const chip = "rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted hover:border-accent hover:text-accent";
  const check = (on: boolean | undefined, onChange: (v: boolean) => void, text: string) => (
    <label className="flex items-center gap-1.5 text-[12px] text-muted">
      <input type="checkbox" checked={!!on} onChange={(e) => onChange(e.target.checked)} />
      {text}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={t("Chart")} className="flex max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-semibold">{initial ? t("Edit chart") : t("Add a chart")}</h2>
          {!initial && (
            <Segmented
              value={mode}
              label={t("Chart")}
              options={[
                { value: "library", label: t("Library") },
                { value: "build", label: t("Build your own") },
              ]}
              onChange={setMode}
            />
          )}
          <button type="button" onClick={onClose} aria-label={t("Close")} className="ml-auto text-muted-2 hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-hidden p-5 lg:grid-cols-[400px_1fr]">
          {mode === "library" ? (
            <div className="flex min-h-0 flex-col">
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search the library")} className={`${field} mb-2 w-full`} />
              <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
                {listed.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => setPicked(p.key)}
                      onDoubleClick={() => onSave(fromPreset(p))}
                      className={`w-full rounded-lg px-3 py-2 text-left ${p.key === picked ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                    >
                      <div className="text-[12px] font-medium">{t(p.title)}</div>
                      <div className="text-[11px] text-muted-2">{t(p.note)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="min-h-0 space-y-4 overflow-auto pr-1 text-[12px]">
              <label className="block">
                <span className="mb-1 block text-muted-2">{t("Title")}</span>
                <input autoFocus value={spec.title} onChange={(e) => set({ title: e.target.value })} className={`${field} w-full`} />
              </label>

              <div className="space-y-2">
                <Segmented
                  value={pie || scatter ? spec.kind : "combo"}
                  label={t("Chart type")}
                  options={[
                    { value: "combo", label: t("Bars and lines") },
                    { value: "scatter", label: t("Scatter") },
                    { value: "pie", label: t("Pie") },
                    { value: "donut", label: t("Donut") },
                  ]}
                  onChange={(kind) =>
                    set(kind === "scatter" && spec.metrics.length < 2 ? { kind, metrics: [...spec.metrics, { id: metrics.defs.find((d) => d.id !== spec.metrics[0]?.id)?.id ?? spec.metrics[0].id, trend: true }] } : { kind })
                  }
                />
                {scatter && <p className="text-[11px] text-muted-2">{t("The first measure runs across; every other one is plotted up against it, a dot per day or week both were logged.")}</p>}
                {!pie && !scatter && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="self-center text-[11px] text-muted-2">{t("Make every measure:")}</span>
                    <button type="button" className={chip} onClick={() => allAs("line")}>{t("Lines")}</button>
                    <button type="button" className={chip} onClick={() => allAs("bar")}>{t("Bars")}</button>
                    <button type="button" className={chip} onClick={() => allAs("bar", true)}>{t("Stacked bars")}</button>
                    <button type="button" className={chip} onClick={() => allAs("area")}>{t("Areas")}</button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <span className="text-muted-2">{t("Range")}</span>
                  <select value={String(spec.range)} onChange={(e) => set({ range: e.target.value === "phase" || e.target.value === "all" ? e.target.value : Number(e.target.value) })} className={field}>
                    {RANGES.map((r) => (
                      <option key={r} value={String(r)}>
                        {rangeLabel(r)}
                      </option>
                    ))}
                  </select>
                </label>
                {!pie && <Segmented value={spec.by} label={t("Points")} options={[{ value: "day", label: t("Daily") }, { value: "week", label: t("Weekly") }]} onChange={(by) => set({ by })} />}
              </div>

              <div>
                <span className="mb-1 block text-muted-2">{pie ? t("Slices") : t("Measures")}</span>
                <div className="space-y-2">
                  {spec.metrics.map((m, i) => {
                    const def = defs.get(m.id);
                    const type = m.type ?? "line";
                    return (
                      <div key={i} className="rounded-lg border border-border p-2">
                        {scatter && <div className="mb-1 text-[10px] tracking-[0.12em] text-muted-2">{i === 0 ? t("ACROSS (X)") : t("UP (Y)")}</div>}
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            aria-label={t("Colour")}
                            value={m.color ?? def?.color ?? PALETTE[i % PALETTE.length]}
                            onChange={(e) => setMetric(i, { color: e.target.value })}
                            className="size-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                          <select value={m.id} onChange={(e) => setMetric(i, { id: e.target.value, color: undefined, agg: undefined, label: undefined })} className={`${field} min-w-0 flex-1`} aria-label={t("Measure")}>
                            {!def && <option value={m.id}>{t("{id} (not logged)", { id: m.id })}</option>}
                            {groups.map((g) => (
                              <optgroup key={g.group} label={t(g.group)}>
                                {g.defs.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <button type="button" aria-label={t("Move up")} onClick={() => move(i, i - 1)} className="px-0.5 text-muted-2 hover:text-foreground">↑</button>
                          <button type="button" aria-label={t("Move down")} onClick={() => move(i, i + 1)} className="px-0.5 text-muted-2 hover:text-foreground">↓</button>
                          <button
                            type="button"
                            aria-label={t("Remove")}
                            disabled={spec.metrics.length === 1}
                            onClick={() => set({ metrics: spec.metrics.filter((_, j) => j !== i) })}
                            className="px-1 text-muted-2 hover:text-foreground disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-7 text-[11px] text-muted">
                          {!pie && !scatter && (
                            <>
                              <select value={type} onChange={(e) => setMetric(i, { type: e.target.value as ChartMetric["type"] })} className={field} aria-label={t("Draw as")}>
                                {TYPES.map((x) => (
                                  <option key={x.value} value={x.value}>
                                    {t(x.label)}
                                  </option>
                                ))}
                              </select>
                              <Segmented
                                value={m.axis ?? "left"}
                                label={t("Axis")}
                                options={[
                                  { value: "left", label: t("Left axis") },
                                  { value: "right", label: t("Right axis") },
                                ]}
                                onChange={(axis) => setMetric(i, { axis })}
                              />
                              {(type === "line" || type === "area") && check(m.dashed, (dashed) => setMetric(i, { dashed }), t("Dashed"))}
                            </>
                          )}
                          {!pie && !(scatter && i === 0) && check(m.trend, (trend) => setMetric(i, { trend }), t("Trend line"))}
                          <label className="flex items-center gap-1">
                            {pie ? t("Over the range:") : spec.by === "week" ? t("Each week:") : t("Several in a day:")}
                            <select value={m.agg ?? def?.agg ?? "avg"} onChange={(e) => setMetric(i, { agg: e.target.value as Agg })} className={field}>
                              {AGGS.map((a) => (
                                <option key={a} value={a}>
                                  {t(AGG_LABEL[a])}
                                </option>
                              ))}
                            </select>
                          </label>
                          <input value={m.label ?? ""} placeholder={def?.label ?? t("Name")} onChange={(e) => setMetric(i, { label: e.target.value || undefined })} className={`${field} w-40`} aria-label={t("Name")} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {spec.metrics.length < MAX_METRICS && (
                  <button
                    type="button"
                    onClick={() => {
                      const last = spec.metrics[spec.metrics.length - 1];
                      const next = metrics.defs.find((d) => !spec.metrics.some((m) => m.id === d.id))?.id ?? last.id;
                      set({ metrics: [...spec.metrics, { id: next, type: last.type ?? "line", axis: last.axis ?? "left" }] });
                    }}
                    className="mt-2 text-[12px] text-accent hover:underline"
                  >
                    + {pie ? t("Add a slice") : t("Add a measure")}
                  </button>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="text-[11px] tracking-[0.12em] text-muted-2">{t("OPTIONS")}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {!pie && !scatter && check(spec.stack, (stack) => set({ stack }), t("Stack bars on the same axis"))}
                  {!pie && !scatter && check(spec.labels, (labels) => set({ labels }), t("Show values"))}
                  {check(spec.wide, (wide) => set({ wide }), t("Full width"))}
                  {check(spec.tall, (tall) => set({ tall }), t("Taller"))}
                </div>
                {!pie && !scatter && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-20 text-muted-2">{t("Left axis")}</span>
                      <Bound label={t("Lowest")} value={spec.left?.min} onChange={(min) => set({ left: { ...spec.left, min } })} />
                      <span className="text-muted-2">–</span>
                      <Bound label={t("Highest")} value={spec.left?.max} onChange={(max) => set({ left: { ...spec.left, max } })} />
                    </div>
                    {hasRight && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-20 text-muted-2">{t("Right axis")}</span>
                        <Bound label={t("Lowest")} value={spec.right?.min} onChange={(min) => set({ right: { ...spec.right, min } })} />
                        <span className="text-muted-2">–</span>
                        <Bound label={t("Highest")} value={spec.right?.max} onChange={(max) => set({ right: { ...spec.right, max } })} />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-20 text-muted-2">{t("Reference line")}</span>
                      <Bound label={t("Reference line")} value={spec.ref?.value} onChange={(v) => set({ ref: v === null ? null : { value: v, label: spec.ref?.label ?? "" } })} />
                      {spec.ref && <input value={spec.ref.label} placeholder={t("Label")} onChange={(e) => set({ ref: { value: spec.ref!.value, label: e.target.value } })} className={`${field} w-32`} />}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="min-w-0 overflow-auto">{shown ? <ChartView spec={shown} metrics={metrics} today={today} phase={phase} height={300} /> : null}</div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          {mode === "library" && preset && (
            <button
              type="button"
              onClick={() => {
                setSpec(fromPreset(preset));
                setMode("build");
              }}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
            >
              {t("Change it first")}
            </button>
          )}
          <button
            type="button"
            disabled={!shown}
            onClick={() => shown && onSave(mode === "library" ? shown : { ...spec, title: spec.title.trim() || t("Chart") })}
            className="rounded-full bg-accent px-4 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {initial ? t("Save") : t("Add to tab")}
          </button>
        </div>
      </div>
    </div>
  );
}
