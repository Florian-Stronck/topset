"use client";

import { useMemo } from "react";
import { BodyweightPanel } from "@/components/BodyweightPanel";
import { ChartCard, Legend, LineChart, Segmented } from "@/components/charts/charts";
import { CheckinPanel } from "@/components/CheckinPanel";
import type { BodyweightEntry } from "@/lib/bodyweight";
import { colorOf, LOW_READINESS } from "@/lib/checkins";
import { useCommands, type Command } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { setTrackingPref, usePref, type TrackingPrefs } from "@/lib/prefs";
import type { AthleteCheckins } from "@/lib/queries";
import { addDays } from "@/lib/schedule";
import { readinessSeries } from "@/lib/tracking";

const RANGES: TrackingPrefs["checkinRange"][] = [14, 28, 56];

const readinessColor = (v: number) => (v <= LOW_READINESS ? "var(--warn)" : "#3b8fd4");

/**
 * Wellness: how the athlete is doing away from the bar — readiness day by day, whether a
 * rough day showed in how heavy the session felt, their bodyweight against the meet's
 * class, and every check-in answer.
 */
export function WellnessView({
  athleteId,
  unit,
  today,
  checkins,
  drift,
  bodyweight,
  meet,
}: {
  athleteId: string;
  unit: string;
  today: string;
  checkins: AthleteCheckins;
  /** RPE against plan per session, over the longest range. */
  drift: { ymd: string; drift: number }[];
  bodyweight: BodyweightEntry[];
  meet: { name: string; day: string; weightClass: string | null; limit: number | null } | null;
}) {
  const prefs = usePref("tracking");
  const range = prefs.checkinRange;
  const from = addDays(today, -(range - 1));
  const { questions, answers } = checkins;
  const scales = questions.filter((q) => q.kind === "SCALE" && !q.archived);
  const series = useMemo(() => readinessSeries(questions, answers, from, today), [answers, from, questions, today]);
  const days = series.map((p) => formatDate(p.day));
  const every = range > 28 ? 7 : range > 14 ? 3 : 1;
  const driftByDay = new Map(drift.map((d) => [d.ymd, d.drift]));
  const hasScores = series.some((p) => p.score !== null);

  const commands = useMemo<Command[]>(
    () => [
      ...RANGES.map(
        (n): Command => ({
          id: `checkins-range-${n}`,
          group: "Chart",
          title: t("Check-ins: {n} days", { n }),
          run: () => setTrackingPref({ checkinRange: n }),
        }),
      ),
      {
        id: "checkins-low-only",
        group: "Chart",
        title: prefs.lowOnly ? t("Show every check-in day") : t("Show only low-readiness days"),
        run: () => setTrackingPref({ lowOnly: !prefs.lowOnly }),
      },
      {
        id: "readiness-per-question",
        group: "Chart",
        title: prefs.perQuestion ? t("Readiness as one score") : t("Readiness per question"),
        run: () => setTrackingPref({ perQuestion: !prefs.perQuestion }),
      },
      {
        id: "bodyweight-add",
        group: "Chart",
        title: t("Add a weigh-in"),
        keywords: "bodyweight weight scale",
        run: () => {
          const input = document.getElementById("bodyweight-weight") as HTMLInputElement | null;
          input?.scrollIntoView({ block: "center", behavior: "smooth" });
          input?.focus();
        },
      },
    ],
    [prefs.lowOnly, prefs.perQuestion],
  );
  useCommands("tracking-wellness", commands, 1);

  const rangeControl = (
    <Segmented value={range} label={t("Range")} options={RANGES.map((n) => ({ value: n, label: t("{n} days", { n }) }))} onChange={(n) => setTrackingPref({ checkinRange: n })} />
  );

  return (
    <div className="mt-5 space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t("READINESS")}
          note={t("scale answers averaged, 1–5")}
          controls={
            <>
              {scales.length > 1 && (
                <Segmented
                  value={prefs.perQuestion ? "each" : "one"}
                  label={t("Readiness")}
                  options={[
                    { value: "one", label: t("One score") },
                    { value: "each", label: t("Per question") },
                  ]}
                  onChange={(v) => setTrackingPref({ perQuestion: v === "each" })}
                />
              )}
              {rangeControl}
            </>
          }
        >
          {prefs.perQuestion && <Legend series={scales.map((q) => ({ key: q.id, label: q.label, color: colorOf(q.color) }))} />}
          <div className={prefs.perQuestion ? "mt-2" : ""}>
            <LineChart
              categories={days}
              xLabelEvery={every}
              domain={[0, 5]}
              series={
                prefs.perQuestion
                  ? scales.map((q) => ({ key: q.id, label: q.label, color: colorOf(q.color), values: series.map((p) => p.byQuestion[q.id] ?? null) }))
                  : []
              }
              bars={{ label: t("Readiness"), values: series.map((p) => p.score), max: 5, color: readinessColor }}
              zero={{ value: LOW_READINESS, label: t("low") }}
              label={t("Readiness per day")}
              empty={questions.length === 0 ? t("No check-in questions yet. Add them on the athlete's card under Athletes.") : t("Nothing answered in the last {n} days.", { n: range })}
            />
          </div>
        </ChartCard>

        <ChartCard title={t("READINESS VS HOW HEAVY IT FELT")} note={t("bars: readiness · line: RPE against plan")}>
          <LineChart
            categories={days}
            xLabelEvery={every}
            series={[{ key: "drift", label: t("RPE vs plan"), color: "var(--accent)", connect: true, values: series.map((p) => driftByDay.get(p.day) ?? null) }]}
            bars={hasScores ? { label: t("Readiness"), values: series.map((p) => p.score), max: 5, color: readinessColor, faint: true } : undefined}
            zero={{ value: 0, label: t("as planned") }}
            format={(v) => (v > 0 ? `+${v}` : String(v))}
            label={t("Readiness against how far RPE ran from the plan")}
            empty={t("No sessions with RPE logged in the last {n} days.", { n: range })}
          />
        </ChartCard>
      </div>

      <BodyweightPanel athleteId={athleteId} unit={unit} today={today} entries={bodyweight} meet={meet} />

      <div>
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            role="switch"
            aria-checked={prefs.lowOnly}
            onClick={() => setTrackingPref({ lowOnly: !prefs.lowOnly })}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${prefs.lowOnly ? "border-warn/60 text-warn" : "border-border text-muted hover:text-foreground"}`}
          >
            {t("Only low-readiness days")}
          </button>
        </div>
        <CheckinPanel
          questions={questions}
          answers={answers}
          today={today}
          range={range}
          onRange={(n) => setTrackingPref({ checkinRange: (RANGES.includes(n as TrackingPrefs["checkinRange"]) ? n : 14) as TrackingPrefs["checkinRange"] })}
          lowOnly={prefs.lowOnly}
        />
      </div>
    </div>
  );
}
