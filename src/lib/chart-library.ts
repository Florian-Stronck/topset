import { t } from "@/lib/i18n";
import type { MetricDef } from "@/lib/metrics";
import type { ChartMetric, ChartSpec, ChartTab, CoachSettings } from "@/lib/settings";

/**
 * Ready-made charts for the custom tabs. A preset is a chart minus its id; the ones built
 * from the athlete's own check-in questions or targets are made from the measures they have.
 */

export type Preset = { key: string; title: string; note: string; spec: Omit<ChartSpec, "id" | "title"> };

const LIFTS = ["squat", "bench", "dead"] as const;
const ZONE_KEYS = ["<70%", "70–80%", "80–90%", "90%+"];

const line = (id: string, more: Partial<ChartMetric> = {}): ChartMetric => ({ id, type: "line", axis: "left", ...more });
const bar = (id: string, more: Partial<ChartMetric> = {}): ChartMetric => ({ id, type: "bar", axis: "left", ...more });

const FIXED: Preset[] = [
  { key: "e1rm", title: "Estimated 1RMs", note: "Best e1RM of the competition lifts each week", spec: { kind: "combo", by: "week", range: 182, metrics: LIFTS.map((l) => line(`e1rm:${l}`)) } },
  { key: "top", title: "Top sets", note: "Heaviest competition-lift set each week", spec: { kind: "combo", by: "week", range: 182, metrics: LIFTS.map((l) => line(`top:${l}`)) } },
  { key: "e1rm-tonnage", title: "Strength vs workload", note: "e1RMs as lines over weekly tonnage as bars", spec: { kind: "combo", by: "week", range: 182, metrics: [bar("tonnage", { axis: "right" }), ...LIFTS.map((l) => line(`e1rm:${l}`))] } },
  { key: "tonnage-lift", title: "Weekly tonnage by lift", note: "Weight × reps on squat, bench and deadlift", spec: { kind: "combo", by: "week", range: 84, stack: true, metrics: LIFTS.map((l) => bar(`tonnage:${l}`)) } },
  { key: "tonnage-split", title: "Tonnage split by lift", note: "Each lift's share of the work", spec: { kind: "pie", by: "week", range: 28, metrics: LIFTS.map((l) => ({ id: `tonnage:${l}` })) } },
  { key: "tonnage", title: "Weekly tonnage", note: "Every exercise", spec: { kind: "combo", by: "week", range: 182, metrics: [bar("tonnage")] } },
  { key: "rpe", title: "RPE vs plan", note: "Mean planned and logged RPE each week", spec: { kind: "combo", by: "week", range: 84, metrics: [line("rpe-planned", { dashed: true }), line("rpe-logged")] } },
  { key: "drift", title: "RPE drift", note: "Logged minus planned RPE; above 0 felt heavier", spec: { kind: "combo", by: "week", range: 84, metrics: [bar("rpe-drift")], ref: { value: 0, label: "as planned" } } },
  { key: "compliance", title: "Compliance", note: "Share of planned sets done", spec: { kind: "combo", by: "week", range: 84, metrics: [line("compliance", { type: "area" })], ref: { value: 100, label: "all done" }, left: { min: 0, max: 110 } } },
  { key: "sets", title: "Sets done vs planned", note: "Each week", spec: { kind: "combo", by: "week", range: 84, metrics: [bar("sets-due", { color: "#5b5b66" }), bar("sets-done")] } },
  { key: "zones", title: "Intensity zones", note: "Sets per week in each %1RM band", spec: { kind: "combo", by: "week", range: 84, stack: true, metrics: ZONE_KEYS.map((z) => bar(`zone:${z}`)) } },
  { key: "zones-split", title: "Intensity split", note: "Share of sets in each %1RM band", spec: { kind: "donut", by: "week", range: 28, metrics: ZONE_KEYS.map((z) => ({ id: `zone:${z}` })) } },
  { key: "bw", title: "Bodyweight", note: "Daily weigh-ins and the 7-day average", spec: { kind: "combo", by: "day", range: 56, metrics: [line("bw", { type: "dots" }), line("bw-avg7")] } },
  { key: "bw-kcal", title: "Bodyweight vs calories", note: "Weekly average weight over weekly average kcal", spec: { kind: "combo", by: "week", range: 84, metrics: [bar("kcal", { axis: "right" }), line("bw")] } },
  { key: "kcal", title: "Calories vs target", note: "Daily", spec: { kind: "combo", by: "day", range: 28, metrics: [bar("kcal"), line("kcal-target", { dashed: true })] } },
  { key: "macros", title: "Macros", note: "Protein, carbs and fat, daily", spec: { kind: "combo", by: "day", range: 28, stack: true, metrics: [bar("protein"), bar("carbs"), bar("fat")] } },
  { key: "macro-split", title: "Macro split", note: "Average grams of protein, carbs and fat", spec: { kind: "pie", by: "week", range: 28, metrics: [{ id: "protein", agg: "avg" }, { id: "carbs", agg: "avg" }, { id: "fat", agg: "avg" }] } },
  { key: "readiness-rpe", title: "Readiness vs RPE drift", note: "Does a rough week show under the bar?", spec: { kind: "combo", by: "week", range: 84, metrics: [bar("readiness", { axis: "right" }), line("rpe-drift")] } },
  { key: "readiness", title: "Readiness", note: "Scale answers averaged, 1–5", spec: { kind: "combo", by: "day", range: 28, metrics: [line("readiness", { type: "area" })], left: { min: 1, max: 5 } } },
  { key: "injuries", title: "Injuries vs tonnage", note: "Worst injury severity over weekly tonnage", spec: { kind: "combo", by: "week", range: 182, metrics: [bar("tonnage", { axis: "right" }), line("injury-severity")] } },
  { key: "e1rm-trend", title: "Strength trend", note: "e1RMs with the line they are heading along", spec: { kind: "combo", by: "week", range: "all", metrics: LIFTS.map((l) => line(`e1rm:${l}`, { type: "dots", trend: true })) } },
  { key: "bw-trend", title: "Bodyweight trend", note: "Daily weigh-ins and the rate they are moving at", spec: { kind: "combo", by: "day", range: 56, metrics: [line("bw", { type: "dots", trend: true })] } },
  { key: "sc-readiness-rpe", title: "Readiness against RPE drift", note: "Scatter: does a low-readiness day feel heavier?", spec: { kind: "scatter", by: "day", range: 182, metrics: [{ id: "readiness" }, { id: "rpe-drift", trend: true }] } },
  { key: "sc-bw-e1rm", title: "Bodyweight against e1RM", note: "Scatter: strength gained per kilo, week by week", spec: { kind: "scatter", by: "week", range: "all", metrics: [{ id: "bw" }, ...LIFTS.map((l) => ({ id: `e1rm:${l}`, trend: true }))] } },
  { key: "sc-tonnage-rpe", title: "Tonnage against logged RPE", note: "Scatter: how hard a heavier week feels", spec: { kind: "scatter", by: "week", range: "all", metrics: [{ id: "tonnage" }, { id: "rpe-logged", trend: true }] } },
  { key: "sc-kcal-bw", title: "Calories against bodyweight", note: "Scatter: weekly averages", spec: { kind: "scatter", by: "week", range: "all", metrics: [{ id: "kcal" }, { id: "bw", trend: true }] } },
  { key: "prs", title: "PRs", note: "PRs the athlete flagged each week", spec: { kind: "combo", by: "week", range: 365, labels: true, metrics: [bar("prs")] } },
];

/** The library for one athlete: the fixed charts, then one per check-in question and per target. */
export function presetsFor(defs: MetricDef[]): Preset[] {
  const scales = defs.filter((d) => d.id.startsWith("q15:"));
  const questions = defs.filter((d) => d.id.startsWith("q:"));
  const targets = defs.filter((d) => d.id.startsWith("sets-t:"));
  const out = [...FIXED];
  if (scales.length > 1) {
    out.push({ key: "scales", title: "Every scale question", note: "On one 1–5 reading", spec: { kind: "combo", by: "day", range: 28, metrics: scales.slice(0, 6).map((d) => line(d.id)) } });
  }
  for (const q of questions) {
    out.push({ key: q.id, title: q.label, note: "Check-in answer", spec: { kind: "combo", by: "day", range: 28, metrics: [line(q.id, { trend: true })] } });
    out.push({
      key: `sc-${q.id}`,
      title: t("{question} against RPE drift", { question: q.label }),
      note: "Scatter: each training day",
      spec: { kind: "scatter", by: "day", range: 182, metrics: [{ id: q.id }, { id: "rpe-drift", trend: true }] },
    });
  }
  if (targets.length > 0) {
    out.push({ key: "sets-target", title: "Sets per target", note: "Sets done each week", spec: { kind: "combo", by: "week", range: 56, stack: true, metrics: targets.slice(0, 8).map((d) => bar(d.id)) } });
    out.push({ key: "target-split", title: "Sets split by target", note: "Share of the sets done", spec: { kind: "donut", by: "week", range: 28, metrics: targets.slice(0, 10).map((d) => ({ id: d.id })) } });
  }
  return out;
}

/** A chart saved before combo charts, as a combo: its bar measure on the right, or all bars stacked. */
export function normalize(spec: ChartSpec): ChartSpec {
  if (spec.kind === "line") {
    return { ...spec, kind: "combo", metrics: spec.metrics.map(({ bars, ...m }) => (bars ? { ...m, type: "bar", axis: "right" } : { type: "line", axis: "left", ...m })) };
  }
  if (spec.kind === "stacked") return { ...spec, kind: "combo", stack: true, metrics: spec.metrics.map((m) => ({ ...m, type: "bar", axis: "left" })) };
  return spec;
}

/** Short random id, for tabs and charts. */
export const newId = () => Math.random().toString(36).slice(2, 10);

/** The athlete's own tabs if the coach gave them some, else the coach's. */
export function tabsFor(settings: Pick<CoachSettings, "charts">, athleteId: string): { tabs: ChartTab[]; own: boolean } {
  const own = settings.charts.athletes[athleteId];
  return own ? { tabs: own, own: true } : { tabs: settings.charts.tabs, own: false };
}
