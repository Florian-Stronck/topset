"use client";

import { ChartCard, LineChart } from "@/components/charts/charts";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { acwrZone, type WeekLoad } from "@/lib/load";

const ZONE_STYLE = { low: "text-muted", ok: "text-ok", high: "text-warn", spike: "text-miss" } as const;
const ZONE_NOTE = {
  low: "under the usual 0.8–1.3",
  ok: "inside the usual 0.8–1.3",
  high: "climbing past 1.3",
  spike: "a spike — well over the last month",
} as const;

/**
 * Session load for the timed work — rounds, sparring, intervals — as session RPE ×
 * minutes: this week against the plan, how it compares with the last month, and week by
 * week. Lifting has no minutes, so it isn't in here.
 */
export function LoadView({
  weeks,
  current,
  ratio,
}: {
  /** Week by week, oldest first, the current one among them. */
  weeks: WeekLoad[];
  current: WeekLoad;
  /** Acute:chronic ratio today; null until there are four weeks behind it. */
  ratio: number | null;
}) {
  const zone = ratio === null ? null : acwrZone(ratio);
  const tile = "rounded-xl border border-border bg-surface px-4 py-3";
  const label = "text-[10px] tracking-[0.14em] text-muted-2";

  return (
    <div className="mt-5 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={tile}>
          <div className={label}>{t("THIS WEEK")}</div>
          <div className="mt-1 text-[22px] font-semibold tabular-nums">
            {current.done} <span className="text-[12px] font-normal text-muted">AU</span>
          </div>
          <div className="text-[11px] text-muted-2">
            {current.planned > 0 ? t("of {n} planned", { n: current.planned }) : t("nothing planned")}
          </div>
        </div>
        <div className={tile}>
          <div className={label}>{t("MINUTES")}</div>
          <div className="mt-1 text-[22px] font-semibold tabular-nums">{current.minutes}</div>
          <div className="text-[11px] text-muted-2">{t("of timed work done")}</div>
        </div>
        <div className={tile}>
          <div className={label} title={t("The last 7 days against the weekly average of the last 28")}>
            {t("ACUTE : CHRONIC")}
          </div>
          <div className={`mt-1 text-[22px] font-semibold tabular-nums ${zone ? ZONE_STYLE[zone] : ""}`}>{ratio ?? "—"}</div>
          <div className="text-[11px] text-muted-2">{zone ? t(ZONE_NOTE[zone]) : t("needs four weeks of load")}</div>
        </div>
        <div className={tile}>
          <div className={label} title={t("Mean daily load over its spread. Over 2, every day looks the same.")}>
            {t("MONOTONY · STRAIN")}
          </div>
          <div className={`mt-1 text-[22px] font-semibold tabular-nums ${current.monotony !== null && current.monotony > 2 ? "text-warn" : ""}`}>
            {current.monotony ?? "—"}
            <span className="text-[13px] font-normal text-muted"> · {current.strain ?? "—"}</span>
          </div>
          <div className="text-[11px] text-muted-2">{t("this week")}</div>
        </div>
      </div>

      <ChartCard title={t("LOAD BY WEEK")} note={t("session RPE × minutes, timed rows only")}>
        <LineChart
          categories={weeks.map((w) => formatDate(w.start))}
          series={[
            { key: "done", label: t("Done"), color: "var(--accent)", values: weeks.map((w) => w.done) },
            { key: "planned", label: t("Planned"), color: "var(--muted)", values: weeks.map((w) => w.planned), dashed: true },
          ]}
          domain={[0, Math.max(1, ...weeks.map((w) => Math.max(w.done, w.planned))) * 1.1]}
          format={(v) => String(Math.round(v))}
          label={t("Load by week")}
          empty={t("No timed work yet.")}
          xLabelEvery={weeks.length > 12 ? 2 : 1}
        />
      </ChartCard>
    </div>
  );
}
