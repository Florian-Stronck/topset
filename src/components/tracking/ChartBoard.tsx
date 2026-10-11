"use client";

import { useMemo, useState } from "react";
import { ChartCard, ComboChart, compact, Legend, PieChart, ScatterChart, type ComboSeries } from "@/components/charts/charts";
import { useSettings } from "@/components/SettingsProvider";
import { ChartBuilder } from "@/components/tracking/ChartBuilder";
import { newId, normalize, presetsFor, tabsFor } from "@/lib/chart-library";
import { useCommands, type Command } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { bucket, fitLine, PALETTE, reduce, type MetricDef, type Metrics } from "@/lib/metrics";
import { addDays } from "@/lib/schedule";
import type { ChartMetric, ChartSpec, ChartTab } from "@/lib/settings";

/** The chart tabs Tracking shows for an athlete, and how to change them. */
export function useChartTabs(athleteId: string) {
  const { settings, update } = useSettings();
  const { tabs, own } = tabsFor(settings, athleteId);
  return {
    tabs,
    own,
    /** Writes to the athlete's own set when they have one, else to the coach's. */
    save: (next: ChartTab[]) => update({ charts: own ? { athletes: { [athleteId]: next } } : { tabs: next } }),
    customise: () => update({ charts: { athletes: { [athleteId]: structuredClone(settings.charts.tabs) } } }),
    reset: () => update({ charts: { athletes: { [athleteId]: null } } }),
  };
}

/** One tab of the coach's own charts. */
export function ChartBoard({
  tabId,
  athlete,
  metrics,
  today,
  phase,
}: {
  tabId: string;
  athlete: { id: string; name: string };
  metrics: Metrics;
  today: string;
  /** The phase open in Tracking, for charts ranged over it. */
  phase: { from: string; to: string } | null;
}) {
  const { tabs, save, own } = useChartTabs(athlete.id);
  const tab = tabs.find((x) => x.id === tabId);
  // null: closed; "library" or "build": a new chart; a spec: editing that chart.
  const [editing, setEditing] = useState<"library" | "build" | ChartSpec | null>(null);
  const presets = useMemo(() => presetsFor(metrics.defs), [metrics.defs]);

  const commands = useMemo<Command[]>(
    () =>
      tab
        ? [
            { id: "chart-library", group: "Chart", title: t("Add a chart from the library"), keywords: "graph custom tab preset", run: () => setEditing("library") },
            { id: "chart-add", group: "Chart", title: t("Build a chart"), keywords: "graph custom tab metric new", run: () => setEditing("build") },
          ]
        : [],
    [tab],
  );
  useCommands("tracking-charts", commands, 1);

  if (!tab) {
    return <p className="mt-10 text-center text-[13px] text-muted">{own ? t("{name} has no tab like this.", { name: athlete.name }) : t("This tab was removed.")}</p>;
  }

  const setCharts = (charts: ChartSpec[]) => save(tabs.map((x) => (x.id === tab.id ? { ...x, charts } : x)));
  const at = (i: number, j: number) => {
    if (j < 0 || j >= tab.charts.length) return;
    const next = [...tab.charts];
    [next[i], next[j]] = [next[j], next[i]];
    setCharts(next);
  };

  return (
    <div className="mt-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {own && <span className="text-[11px] text-muted-2">{t("Charts of {name} only", { name: athlete.name })}</span>}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setEditing("library")} className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent">
            {t("Library")}
          </button>
          <button type="button" onClick={() => setEditing("build")} className="rounded-full bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
            {t("Build a chart")}
          </button>
        </div>
      </div>

      {tab.charts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <div className="text-[13px]">{t("No charts on this tab yet.")}</div>
          <div className="mt-1 text-[12px] text-muted">{t("Take one from the library, or build your own from anything Tracking records.")}</div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {tab.charts.map((spec, i) => (
            <div key={spec.id} className={spec.wide ? "xl:col-span-2" : ""}>
              <ChartView
                spec={spec}
                metrics={metrics}
                today={today}
                phase={phase}
                controls={
                  <>
                    <Tool label={t("Move up")} onClick={() => at(i, i - 1)} d="M12 19V5M5 12l7-7 7 7" />
                    <Tool label={t("Move down")} onClick={() => at(i, i + 1)} d="M12 5v14M5 12l7 7 7-7" />
                    <Tool label={spec.wide ? t("Half width") : t("Full width")} onClick={() => setCharts(tab.charts.map((c) => (c.id === spec.id ? { ...c, wide: !c.wide } : c)))} d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />
                    <Tool label={t("Edit")} onClick={() => setEditing(spec)} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    <Tool label={t("Duplicate")} onClick={() => setCharts([...tab.charts.slice(0, i + 1), { ...spec, id: newId() }, ...tab.charts.slice(i + 1)])} d="M8 8h12v12H8zM4 16V4h12" />
                    <Tool label={t("Remove")} onClick={() => setCharts(tab.charts.filter((c) => c.id !== spec.id))} d="M18 6 6 18M6 6l12 12" />
                  </>
                }
              />
            </div>
          ))}
        </div>
      )}

      {editing !== null && (
        <ChartBuilder
          start={typeof editing === "string" ? editing : "build"}
          initial={typeof editing === "string" ? null : editing}
          presets={presets}
          metrics={metrics}
          today={today}
          phase={phase}
          onClose={() => setEditing(null)}
          onSave={(spec) => {
            const exists = tab.charts.some((c) => c.id === spec.id);
            setCharts(exists ? tab.charts.map((c) => (c.id === spec.id ? spec : c)) : [...tab.charts, spec]);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Tool({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="grid size-6 place-items-center rounded-full text-muted-2 hover:bg-surface-2 hover:text-accent">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  );
}

/** The days a chart covers. */
function spanOf(spec: Pick<ChartSpec, "range" | "metrics">, metrics: Metrics, today: string, phase: { from: string; to: string } | null) {
  if (spec.range === "phase" && phase) return phase;
  if (spec.range === "all") {
    const first = spec.metrics.map((m) => metrics.points[m.id]?.[0]?.[0]).filter((d): d is string => !!d).sort()[0];
    return { from: first && first < today ? first : addDays(today, -27), to: today };
  }
  return { from: addDays(today, -((typeof spec.range === "number" ? spec.range : 28) - 1)), to: today };
}

/** A chart as its spec says, from the athlete's measures. */
export function ChartView({
  spec: saved,
  metrics,
  today,
  phase,
  controls,
  height,
}: {
  spec: ChartSpec;
  metrics: Metrics;
  today: string;
  phase: { from: string; to: string } | null;
  controls?: React.ReactNode;
  height?: number;
}) {
  const { settings } = useSettings();
  const spec = normalize(saved);
  const tall = height ?? (spec.tall ? 320 : 220);
  const { from, to } = spanOf(spec, metrics, today, phase);
  const defs = new Map(metrics.defs.map((d) => [d.id, d]));
  // A measure this athlete never logged is left off, rather than named by its id.
  const shown = spec.metrics
    .map((m, i) => ({ m, i, def: defs.get(m.id) }))
    .filter((x): x is { m: ChartMetric; i: number; def: MetricDef } => x.def !== undefined)
    .map(({ m, i, def }) => ({
      m,
      def,
      key: `${m.id}#${i}`,
      label: m.label?.trim() || (def.unit ? `${def.label} (${def.unit})` : def.label),
      color: m.color ?? def.color ?? PALETTE[i % PALETTE.length],
      agg: m.agg ?? def.agg,
    }));
  const empty = t("Nothing logged for this in that time.");
  const pie = spec.kind === "pie" || spec.kind === "donut";

  const series = (x: (typeof shown)[number]) => bucket(metrics.points[x.m.id] ?? [], spec.by, x.agg, from, to, settings.weekStart);
  const period = spec.by === "week" ? t("/wk") : t("/day");
  // Each measure's trend, as change per day or week, for the legend.
  const slopes = new Map<string, string>();

  let chart: React.ReactNode;
  let note: string;
  if (spec.kind === "scatter") {
    const [across, ...up] = shown;
    note = `${spec.by === "week" ? t("per week") : t("per day")} · ${formatDate(from)} – ${formatDate(to)}`;
    const xs = across ? series(across) : [];
    chart = (
      <ScatterChart
        height={tall}
        label={spec.title}
        empty={up.length === 0 ? t("Add a second measure to plot against the first.") : empty}
        xLabel={across ? `${across.label} →` : ""}
        series={up.map((s) => {
          const ys = series(s);
          const points = xs.flatMap((b, i) => (b.value !== null && ys[i].value !== null ? [{ x: b.value, y: ys[i].value as number, tag: formatDate(b.key) }] : []));
          return { key: s.key, label: s.label, color: s.color, points, trend: s.m.trend ? fitLine(points.map((p) => [p.x, p.y])) : null };
        })}
      />
    );
  } else if (pie) {
    note = `${formatDate(from)} – ${formatDate(to)}`;
    chart = (
      <PieChart
        donut={spec.kind === "donut"}
        height={tall - 20}
        label={spec.title}
        empty={empty}
        slices={shown.map((x) => {
          const values = (metrics.points[x.m.id] ?? []).filter(([d]) => d >= from && d <= to).map(([, v]) => v);
          return { key: x.key, label: x.label, color: x.color, value: values.length ? Math.round(reduce(values, x.agg) * 10) / 10 : 0 };
        })}
      />
    );
  } else {
    note = spec.by === "week" ? t("per week") : t("per day");
    const combo: ComboSeries[] = shown.map((x) => {
      const values = series(x).map((b) => b.value);
      const trend = x.m.trend ? fitLine(values.flatMap((v, i) => (v === null ? [] : [[i, v] as [number, number]]))) : null;
      if (trend) slopes.set(x.key, `${trend.slope >= 0 ? "+" : ""}${compact(trend.slope)}${period}`);
      return { key: x.key, label: x.label, color: x.color, type: x.m.type ?? "line", axis: x.m.axis ?? "left", dashed: x.m.dashed, values, trend };
    });
    const categories = bucket([], spec.by, "avg", from, to, settings.weekStart).map((b) => formatDate(b.key));
    chart = (
      <ComboChart
        categories={categories}
        series={combo}
        height={tall}
        label={spec.title}
        empty={empty}
        stack={spec.stack}
        left={spec.left}
        right={spec.right}
        refLine={spec.ref}
        labels={spec.labels}
        // About as many dates as fit under a half-width card, twice that across the page.
        xLabelEvery={Math.max(1, Math.ceil(categories.length / (spec.wide ? 12 : 6)))}
      />
    );
  }

  return (
    <ChartCard title={spec.title.toUpperCase()} note={note} controls={controls}>
      {!pie && (spec.kind === "scatter" ? shown.length > 2 : shown.length > 1 || slopes.size > 0) && (
        <div className="mb-1">
          <Legend
            series={(spec.kind === "scatter" ? shown.slice(1) : shown).map((x) => ({
              key: x.key,
              label: [x.label, x.m.axis === "right" && spec.kind !== "scatter" ? "→" : "", slopes.has(x.key) ? `· ${t("trend")} ${slopes.get(x.key)}` : ""].filter(Boolean).join(" "),
              color: x.color,
            }))}
          />
        </div>
      )}
      {chart}
    </ChartCard>
  );
}
