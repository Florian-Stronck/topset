"use client";

import { useState, useTransition } from "react";
import { saveNutrition } from "@/app/tracking/actions";
import { ChartCard, LineChart } from "@/components/charts/charts";
import { NUTRIENT_UNIT, NUTRIENTS, type Nutrient } from "@/lib/checkins";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { averages, hitTarget, targetOn, type NutritionEntry, type TargetSpan } from "@/lib/nutrition";
import { addDays } from "@/lib/schedule";

const LABEL: Record<Nutrient, string> = { kcal: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat" };
const COLOR: Record<Exclude<Nutrient, "kcal">, string> = { protein: "#ef4444", carbs: "#eab308", fat: "#14b8a6" };
const MACROS = ["protein", "carbs", "fat"] as const;

/** A day's numbers as the fields show them, empty where there are none. */
const fields = (e: NutritionEntry | undefined) =>
  Object.fromEntries(NUTRIENTS.map((n) => [n, e?.[n] == null ? "" : String(e[n])])) as Record<Nutrient, string>;

/**
 * Nutrition on Tracking, kept like bodyweight: the day's totals as the athlete gave them in
 * the check-in, or as the coach typed them in here. Calories as bars, the macros as lines,
 * the 7-day averages on top, and the days themselves to correct. Where the phase sets
 * targets, they show as dashed lines, the averages read against today's, and each day is
 * marked hit or missed.
 */
export function NutritionPanel({
  athleteId,
  today,
  range,
  entries: initial,
  targets = [],
  readOnly = false,
}: {
  athleteId: string;
  today: string;
  /** Days back the chart shows. */
  range: number;
  /** Oldest first. */
  entries: NutritionEntry[];
  /** The phases' targets. */
  targets?: TargetSpan[];
  readOnly?: boolean;
}) {
  const [entries, setEntries] = useState(initial);
  const [synced, setSynced] = useState(initial);
  const [day, setDay] = useState(today);
  const [draft, setDraft] = useState(() => fields(initial.find((e) => e.day === today)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // New days from the athlete arrive with a refresh.
  if (synced !== initial) {
    setSynced(initial);
    setEntries(initial);
  }

  const avg = averages(entries, today);
  const from = addDays(today, -(range - 1));
  const days: string[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) days.push(d);
  const byDay = new Map(entries.map((e) => [e.day, e]));
  const kcal = days.map((d) => byDay.get(d)?.kcal ?? null);
  const maxKcal = Math.max(0, ...kcal.filter((v): v is number => v !== null));

  /** Picking a day fills the fields with what it has, so saving corrects it rather than wiping it. */
  function pick(d: string) {
    setDay(d);
    setDraft(fields(byDay.get(d)));
  }

  function save(d: string, values: Partial<Record<Nutrient, string>>) {
    setError(null);
    startTransition(async () => {
      try {
        const entry = await saveNutrition(athleteId, d, values);
        setEntries((was) => [...was.filter((e) => e.day !== d), ...(entry ? [entry] : [])].sort((a, b) => a.day.localeCompare(b.day)));
        if (d === day) setDraft(fields(entry ?? undefined));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (readOnly && entries.length === 0) return null;
  const now = targetOn(targets, today);
  const summary = NUTRIENTS.filter((n) => avg[n] !== null).map((n) => {
    const goal = now?.[n] ?? null;
    const off = goal ? Math.round(((avg[n]! - goal) / goal) * 100) : null;
    return `${t(LABEL[n])} ${avg[n]}${goal ? `/${goal}` : ""} ${NUTRIENT_UNIT[n]}${off !== null && off !== 0 ? ` (${off > 0 ? "+" : ""}${off}%)` : ""}`;
  });
  const hitOf = (e: NutritionEntry) => hitTarget(e, targetOn(targets, e.day));
  const judged = days.map((d) => byDay.get(d)).filter((e): e is NutritionEntry => e !== undefined && hitOf(e) !== null);
  const hits = judged.filter((e) => hitOf(e)).length;

  return (
    <ChartCard
      title={t("NUTRITION")}
      note={[
        summary.length ? `${t("7-day avg")} · ${summary.join(" · ")}` : null,
        judged.length ? t("{hit} of {n} days on target", { hit: hits, n: judged.length }) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {entries.length === 0 ? (
        <p className="text-[12px] text-muted-2">
          {t("No nutrition logged yet. Add a Calories or macro question to the check-in, or log a day here.")}
        </p>
      ) : (
        <LineChart
          categories={days.map((d) => formatDate(d))}
          xLabelEvery={range > 28 ? 7 : range > 14 ? 3 : 1}
          series={[
            ...MACROS.map((n) => ({ key: n, label: `${t(LABEL[n])} (g)`, color: COLOR[n], connect: true, values: days.map((d) => byDay.get(d)?.[n] ?? null) })),
            ...MACROS.filter((n) => days.some((d) => targetOn(targets, d)?.[n] != null)).map((n) => ({
              key: `${n}-target`,
              label: t("{what} target", { what: t(LABEL[n]) }),
              color: COLOR[n],
              dashed: true,
              values: days.map((d) => targetOn(targets, d)?.[n] ?? null),
            })),
          ]}
          bars={maxKcal > 0 ? { label: t("Calories"), values: kcal, max: maxKcal, color: () => "#f9731655", format: (v) => `${v} kcal` } : undefined}
          format={(v) => `${Math.round(v)} g`}
          label={t("Calories and macros per day")}
          empty={t("Nothing logged in the last {n} days.", { n: range })}
        />
      )}

      {!readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => pick(e.target.value || today)}
            className="h-8 rounded-lg border border-border bg-surface-2 px-2 text-[12px] outline-none focus:border-accent"
          />
          {NUTRIENTS.map((n) => (
            <input
              key={n}
              id={n === "kcal" ? "nutrition-kcal" : undefined}
              type="text"
              inputMode="numeric"
              value={draft[n]}
              placeholder={n === "kcal" ? "kcal" : `${t(LABEL[n])} g`}
              aria-label={`${t(LABEL[n])} (${NUTRIENT_UNIT[n]})`}
              onChange={(e) => setDraft((was) => ({ ...was, [n]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(day, draft);
              }}
              className="h-8 w-24 rounded-lg border border-border bg-surface-2 px-2 text-center text-[12px] tabular-nums outline-none placeholder:text-muted-2 focus:border-accent"
            />
          ))}
          <button
            type="button"
            onClick={() => save(day, draft)}
            disabled={pending || NUTRIENTS.every((n) => draft[n].trim() === "")}
            className="h-8 rounded-lg border border-border px-3 text-[12px] text-muted hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {byDay.has(day) ? t("Save day") : t("Add day")}
          </button>
          {error && <span className="text-[11px] text-miss">{error}</span>}
        </div>
      )}

      {entries.length > 0 && (
        <ul className="mt-3 max-h-[168px] divide-y divide-border/60 overflow-auto border-t border-border text-[12px]">
          {[...entries].reverse().slice(0, 30).map((e) => (
            <li key={e.id} className="group flex items-center gap-3 py-1.5">
              <button type="button" disabled={readOnly} onClick={() => pick(e.day)} className="w-24 shrink-0 text-left text-muted hover:text-foreground">
                {formatDate(e.day, true)}
              </button>
              <HitDot hit={hitOf(e)} />
              {NUTRIENTS.map((n) => (
                <span key={n} className="w-20 shrink-0 tabular-nums">
                  {e[n] === null ? <span className="text-muted-2">—</span> : `${e[n]} ${NUTRIENT_UNIT[n]}`}
                </span>
              ))}
              <span className="flex-1 truncate text-[11px] text-muted-2">
                {e.source === "coach" ? (readOnly ? t("added by the coach") : t("added by you")) : t("from the app")}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => save(e.day, {})}
                  title={t("Delete this day")}
                  className="rounded px-1.5 text-muted-2 opacity-40 hover:text-miss focus:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** A small dot for a day against its target: hit, missed, or nothing to judge. */
function HitDot({ hit }: { hit: boolean | null }) {
  if (hit === null) return <span className="size-1.5 shrink-0" />;
  return (
    <span
      title={hit ? t("On target") : t("Off target")}
      className={`size-1.5 shrink-0 rounded-full ${hit ? "bg-ok" : "bg-warn"}`}
    />
  );
}
