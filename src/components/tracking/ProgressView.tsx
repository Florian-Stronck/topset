"use client";

import { useMemo, useTransition } from "react";
import { updateAthlete } from "@/app/programming/actions";
import { BarChart, ChartCard, Legend, LineChart, Segmented, type Series } from "@/components/charts/charts";
import { ExerciseHistoryPanel } from "@/components/ExerciseHistoryPanel";
import { LiftChart } from "@/components/LiftChart";
import { useSettings } from "@/components/SettingsProvider";
import { VolumeTable } from "@/components/VolumeTable";
import { useCommands, type Command } from "@/lib/commands";
import type { ExerciseHistory } from "@/lib/exercise-history";
import { t } from "@/lib/i18n";
import { colorOfTarget, setTrackingPref, usePref, type TrackingPrefs } from "@/lib/prefs";
import {
  complianceByWeek,
  intensityZones,
  LIFT_COLOR,
  LIFT_LABEL,
  LIFT_ORDER,
  liftWeekTable,
  rpeByWeek,
  weeklyTonnage,
  ZONES,
  type LiftKey,
  type LiftSeries,
} from "@/lib/progress";
import { bestEstimates } from "@/lib/tracking";
import type { AthleteData, BlockData } from "@/lib/types";

const RANGE_LABEL: Record<TrackingPrefs["chartRange"], string> = {
  phase: "Phase",
  program: "Program",
  "12w": "12 weeks",
  all: "All",
};

const ZONE_COLOR = ["#5b7a99", "#3b8fd4", "#b87a2e", "#e5365a"];
/** For targets without a colour of their own, in a fixed order. */
const PALETTE = ["#3b8fd4", "#e5365a", "#b87a2e", "#3ecf8e", "#a78bfa", "#f472b6", "#94a3b8", "#f59e0b", "#22d3ee"];

/**
 * Progress: is the athlete getting stronger, and is the work landing where it was meant
 * to? The best 1RMs this phase up top, then strength over time and the phase week by week.
 */
export function ProgressView({
  block,
  athlete,
  today,
  series,
  history,
}: {
  block: BlockData;
  athlete: AthleteData;
  today: string;
  series: Record<"prescribed" | "estimated", LiftSeries[]>;
  history: ExerciseHistory[];
}) {
  const prefs = usePref("tracking");
  const targetColors = usePref("targetColors");
  const prHighlight = useSettings().settings.pr.highlight;
  const [, startTransition] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const bests = bestEstimates(block, athlete);
  const chartLift: LiftKey = prefs.chartLift === "all" ? "squat" : prefs.chartLift;
  const weeks = block.weeks.map((w) => t("Wk {n}", { n: w.order }));
  const lifts = { squat: t("Squat"), bench: t("Bench"), dead: t("Deadlift") };

  // The lift chart, narrowed to the range asked for.
  const ranged = useMemo(() => {
    const from = Date.parse(today) - 12 * 7 * 24 * 60 * 60 * 1000;
    const keep = (p: LiftSeries["points"][number]) =>
      prefs.chartRange === "phase"
        ? p.blockId === block.id
        : prefs.chartRange === "program"
          ? p.programId === block.program.id
          : prefs.chartRange === "12w"
            ? p.t >= from
            : true;
    const narrow = (list: LiftSeries[]) => list.map((s) => ({ ...s, points: s.points.filter(keep) }));
    return { prescribed: narrow(series.prescribed), estimated: narrow(series.estimated) };
  }, [block.id, block.program.id, prefs.chartRange, series, today]);

  const hidden = useMemo(() => new Set<LiftKey>(prefs.chartHidden), [prefs.chartHidden]);
  const toggleLift = (lift: LiftKey) =>
    setTrackingPref({ chartHidden: hidden.has(lift) ? prefs.chartHidden.filter((l) => l !== lift) : [...prefs.chartHidden, lift] });

  const saveAs1rm = (lift: LiftKey, value: number) =>
    startTransition(() => {
      void updateAthlete(athlete.id, lift === "squat" ? { squat1RM: value } : lift === "bench" ? { bench1RM: value } : { dead1RM: value });
    });

  const tonnage = weeklyTonnage(block, prefs.tonnageBy, { other: t("Other"), noTarget: t("No target"), lifts });
  const order = [...LIFT_ORDER.map((l) => lifts[l]), t("Other")];
  const tonnageKeys = [...new Set(tonnage.flatMap((w) => Object.keys(w.parts)))].sort((a, b) =>
    prefs.tonnageBy === "lift" ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b),
  );
  const tonnageSeries: Series[] = tonnageKeys.map((key, i) => {
    const lift = (Object.keys(lifts) as LiftKey[]).find((l) => lifts[l] === key);
    const color =
      prefs.tonnageBy === "lift"
        ? lift
          ? LIFT_COLOR[lift]
          : "var(--muted-2)"
        : (colorOfTarget(targetColors, key) ?? PALETTE[i % PALETTE.length]);
    return { key, label: key, color };
  });

  const rpe = rpeByWeek(block, prefs.chartLift);
  const compliance = complianceByWeek(block, today);
  const zones = intensityZones(block, athlete, prefs.chartLift);
  const table = liftWeekTable(block, athlete, chartLift);

  const liftPicker = (withAll: boolean) => (
    <Segmented
      value={withAll ? prefs.chartLift : chartLift}
      label={t("Lift")}
      options={[...(withAll ? [{ value: "all" as const, label: t("All") }] : []), ...LIFT_ORDER.map((l) => ({ value: l, label: lifts[l] }))]}
      onChange={(v) => setTrackingPref({ chartLift: v })}
    />
  );

  const commands = useMemo<Command[]>(
    () => [
      ...LIFT_ORDER.map(
        (lift): Command => ({
          id: `chart-lift-${lift}`,
          group: "Chart",
          title: hidden.has(lift) ? t("Show {lift} in the chart", { lift: lifts[lift] }) : t("Hide {lift} in the chart", { lift: lifts[lift] }),
          run: () => toggleLift(lift),
        }),
      ),
      {
        id: "chart-e1rm-basis",
        group: "Chart",
        title: prefs.chartBasis === "estimated" ? t("Chart the prescribed weights") : t("Chart the estimated 1RMs"),
        keywords: "graph e1rm lift chart",
        run: () => setTrackingPref({ chartBasis: prefs.chartBasis === "estimated" ? "prescribed" : "estimated" }),
      },
      ...(Object.keys(RANGE_LABEL) as TrackingPrefs["chartRange"][]).map(
        (range): Command => ({
          id: `chart-range-${range}`,
          group: "Chart",
          title: t("Chart range: {range}", { range: t(RANGE_LABEL[range]) }),
          run: () => setTrackingPref({ chartRange: range }),
        }),
      ),
      {
        id: "chart-tonnage-by",
        group: "Chart",
        title: prefs.tonnageBy === "lift" ? t("Tonnage by target") : t("Tonnage by lift"),
        run: () => setTrackingPref({ tonnageBy: prefs.tonnageBy === "lift" ? "target" : "lift" }),
      },
      ...bests
        .filter((b) => b.onFile !== b.e1rm)
        .map(
          (b): Command => ({
            id: `use-1rm-${b.lift}`,
            group: "Chart",
            title: t("Use {n} {u} as the {lift} 1RM", { n: b.e1rm, u: unit, lift: t(b.label) }),
            keywords: "max update e1rm",
            run: () => saveAs1rm(b.lift, b.e1rm),
          }),
        ),
      ...history.slice(0, 60).map(
        (h): Command => ({
          id: `history-${h.name.toLowerCase()}`,
          group: "Chart",
          title: t("Exercise history: {name}", { name: h.name }),
          kind: "place",
          run: () => {
            window.dispatchEvent(new CustomEvent("topset:exercise-history", { detail: h.name }));
            document.getElementById("exercise-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
          },
        }),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bests, hidden, history, prefs, unit],
  );
  useCommands("tracking-progress", commands, 1);

  return (
    <div className="mt-5 space-y-5">
      {bests.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {bests.map((best) => {
            const delta = best.onFile === null ? null : Math.round((best.e1rm - best.onFile) * 10) / 10;
            return (
              <div key={best.lift} className={`rounded-xl border bg-surface px-4 py-3 ${best.pr && prHighlight ? "border-ok/60" : "border-border"}`}>
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] tracking-[0.16em] text-muted-2">{t(best.label).toUpperCase()}</span>
                  {best.pr && prHighlight && <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-ok">{t("PR")}</span>}
                  <span className="ml-auto text-[11px] text-muted-2">{t("best e1RM · week {n}", { n: best.week })}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[22px] font-semibold tabular-nums">
                    {best.e1rm} {unit}
                  </span>
                  {delta !== null && delta !== 0 && (
                    <span className={`text-[12px] ${delta > 0 ? "text-ok" : "text-muted-2"}`}>
                      {delta > 0 ? "+" : ""}
                      {delta} {t("vs on file")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-2">
                  {best.exercise} · {best.weight} {unit} × {best.reps}
                  {best.rpe !== null && ` @ RPE ${best.rpe}`}
                </div>
                {best.onFile !== best.e1rm && (
                  <button
                    type="button"
                    onClick={() => saveAs1rm(best.lift, best.e1rm)}
                    title={t("Updates the athlete's record. This program keeps the maxes it was written against.")}
                    className="mt-2 rounded border border-border px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
                  >
                    {t("Use as the {lift} 1RM", { lift: t(best.label) })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <LiftChart
        title="STRENGTH OVER TIME"
        series={ranged}
        unit={unit}
        mode={prefs.chartBasis}
        onMode={(m) => setTrackingPref({ chartBasis: m })}
        hidden={hidden}
        onToggleLift={toggleLift}
        controls={
          <Segmented
            value={prefs.chartRange}
            label={t("Range")}
            options={(Object.keys(RANGE_LABEL) as TrackingPrefs["chartRange"][]).map((r) => ({ value: r, label: t(RANGE_LABEL[r]) }))}
            onChange={(r) => setTrackingPref({ chartRange: r })}
          />
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t("WEEKLY TONNAGE")}
          note={unit}
          controls={
            <Segmented
              value={prefs.tonnageBy}
              label={t("Split")}
              options={[
                { value: "lift", label: t("By lift") },
                { value: "target", label: t("By target") },
              ]}
              onChange={(v) => setTrackingPref({ tonnageBy: v })}
            />
          }
        >
          <Legend series={tonnageSeries} />
          <div className="mt-2">
            <BarChart
              categories={weeks}
              series={tonnageSeries}
              values={tonnage.map((w) => w.parts)}
              format={(v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v.toLocaleString())}
              label={t("Tonnage per week")}
              empty={t("Nothing logged in this phase yet.")}
            />
          </div>
        </ChartCard>

        <ChartCard title={t("RPE VS PLAN")} note={t("mean per week, rows with both")} controls={liftPicker(true)}>
          <LineChart
            categories={weeks}
            series={[
              { key: "planned", label: t("Prescribed"), color: "var(--muted)", dashed: true, values: rpe.map((w) => w.planned) },
              { key: "actual", label: t("Logged"), color: "var(--accent)", values: rpe.map((w) => w.actual) },
            ]}
            label={t("Prescribed against logged RPE per week")}
            empty={t("No RPE logged against an RPE or RIR prescription yet.")}
          />
        </ChartCard>

        <ChartCard title={t("COMPLIANCE")} note={t("sets done of the sets due")}>
          <BarChart
            categories={weeks}
            series={[{ key: "pct", label: t("Done"), color: "var(--ok)" }]}
            values={compliance.map((w): Record<string, number> => (w.pct === null ? {} : { pct: w.pct }))}
            max={100}
            format={(v) => `${v}%`}
            notes={compliance.map((w) => (w.missed > 0 ? t("{n} missed", { n: w.missed }) : null))}
            label={t("Share of sets done per week")}
            empty={t("Nothing due yet.")}
          />
        </ChartCard>

        <ChartCard title={t("INTENSITY ZONES")} note={t("sets done by %1RM")} controls={liftPicker(true)}>
          <Legend series={ZONES.map((z, i) => ({ key: z.key, label: z.key, color: ZONE_COLOR[i] }))} />
          <div className="mt-2">
            <BarChart
              categories={weeks}
              series={ZONES.map((z, i) => ({ key: z.key, label: z.key, color: ZONE_COLOR[i] }))}
              values={zones.map((w) => w.parts)}
              label={t("Sets per week in each intensity band")}
              empty={t("No sets done against a 1RM on file yet.")}
            />
          </div>
        </ChartCard>
      </div>

      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("WEEK BY WEEK")}</h2>
          {liftPicker(false)}
        </div>
        <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="bg-surface-2 text-[10px] tracking-[0.14em] text-muted-2">
              <tr>
                <th className="px-4 py-2 text-left font-normal">{t("WEEK")}</th>
                <th className="px-4 py-2 text-left font-normal">{t("TOP SET")}</th>
                <th className="px-4 py-2 text-right font-normal">{t("E1RM")}</th>
                <th className="px-4 py-2 text-right font-normal">{t("RPE VS PLAN")}</th>
                <th className="px-4 py-2 text-right font-normal">{t("SETS DONE")}</th>
                <th className="px-4 py-2 text-right font-normal">{t("TONNAGE")}</th>
              </tr>
            </thead>
            <tbody>
              {table.map((w, i) => {
                const before = table.slice(0, i).reverse().find((x) => x.e1rm !== null)?.e1rm ?? null;
                const delta = w.e1rm !== null && before !== null ? Math.round((w.e1rm - before) * 10) / 10 : null;
                return (
                  <tr key={w.week} className="border-t border-border/60">
                    <td className="px-4 py-1.5 text-muted">{t("Week {n}", { n: w.week })}</td>
                    <td className="px-4 py-1.5">
                      {w.top ? `${w.top.weight} ${unit} × ${w.top.reps ?? "—"}${w.top.rpe !== null ? ` @${w.top.rpe}` : ""}` : <span className="text-muted-2">—</span>}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {w.e1rm ?? <span className="text-muted-2">—</span>}
                      {delta !== null && delta !== 0 && <span className={`ml-1 text-[11px] ${delta > 0 ? "text-ok" : "text-muted-2"}`}>{delta > 0 ? `+${delta}` : delta}</span>}
                    </td>
                    <td className={`px-4 py-1.5 text-right ${w.rpeDelta !== null && w.rpeDelta >= 1 ? "text-warn" : ""}`}>
                      {w.rpeDelta === null ? <span className="text-muted-2">—</span> : `${w.rpeDelta > 0 ? "+" : w.rpeDelta < 0 ? "" : "±"}${w.rpeDelta}`}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {w.setsPrescribed === 0 ? <span className="text-muted-2">—</span> : `${w.setsDone}/${w.setsPrescribed}`}
                    </td>
                    <td className="px-4 py-1.5 text-right">{w.tonnage > 0 ? w.tonnage.toLocaleString() : <span className="text-muted-2">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-muted-2">
          {t("Top set and e1RM from {lift} rows marked as the competition lift; sets and tonnage from every {lift} row.", { lift: t(LIFT_LABEL[chartLift]).toLowerCase() })}
        </p>
      </section>

      <div id="exercise-history" className="scroll-mt-4">
        <ExerciseHistoryPanel history={history} unit={unit} />
      </div>

      <VolumeTable block={block} activeWeek={0} />
    </div>
  );
}
