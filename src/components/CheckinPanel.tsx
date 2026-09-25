"use client";

import { useState } from "react";
import { CheckinIcon } from "@/components/CheckinIcon";
import { colorOf, formatAnswer, LOW_READINESS, readinessOf, scaleScore, type CheckinAnswerData, type CheckinQuestionData } from "@/lib/checkins";
import { formatDate, weekdayOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { addDays } from "@/lib/schedule";

const RANGES = [14, 28, 56];

/**
 * Everything the athlete answered in the check-in, as a table: one row per day, newest
 * first, with the readiness score and a column per question. Weigh-ins have their own
 * panel further down. Low scale
 * answers are picked out, so a rough stretch reads at a glance.
 */
export function CheckinPanel({
  questions,
  answers,
  today,
  range: rangeFromProps,
  onRange,
  lowOnly = false,
}: {
  questions: CheckinQuestionData[];
  answers: CheckinAnswerData[];
  today: string;
  /** How many days back, when the caller keeps track of it. */
  range?: number;
  onRange?: (days: number) => void;
  /** Only the days readiness came out low. */
  lowOnly?: boolean;
}) {
  const [ownRange, setOwnRange] = useState(14);
  const range = rangeFromProps ?? ownRange;
  const setRange = onRange ?? setOwnRange;
  const from = addDays(today, -(range - 1));
  const inRange = answers.filter((a) => a.day >= from && a.day <= today);

  // Questions still asked, then retired ones that were answered in this stretch.
  const answeredIds = new Set(inRange.map((a) => a.questionId));
  const columns = questions.filter((q) => !q.archived || answeredIds.has(q.id));
  const days = [...new Set(inRange.map((a) => a.day))]
    .sort()
    .reverse()
    .filter((day) => {
      if (!lowOnly) return true;
      const { score } = readinessOf(questions, inRange.filter((a) => a.day === day));
      return score !== null && score <= LOW_READINESS;
    });
  const hasScale = columns.some((q) => q.kind === "SCALE");
  const yesNo = { yes: t("Yes"), no: t("No") };

  return (
    <section id="checkins" className="scroll-mt-4">
      <div className="flex items-center gap-3">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("CHECK-INS")}</h2>
        <div className="ml-auto flex gap-1">
          {RANGES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={range === n}
              onClick={() => setRange(n)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] ${range === n ? "bg-surface-3 text-foreground" : "text-muted-2 hover:text-foreground"}`}
            >
              {t("{n} days", { n })}
            </button>
          ))}
        </div>
      </div>

      {days.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-border px-4 py-4 text-[12px] text-muted-2">
          {columns.length === 0
            ? t("No check-in questions yet. Add them on the athlete's card under Athletes.")
            : lowOnly
              ? t("No low-readiness days in the last {n} days.", { n: range })
              : t("Nothing answered in the last {n} days.", { n: range })}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[11px] text-muted-2">
                <th className="sticky left-0 bg-surface-2 px-3 py-2 font-normal">{t("Day")}</th>
                {hasScale && <th className="px-3 py-2 text-right font-normal">{t("Readiness")}</th>}
                {columns.map((q) => (
                  <th key={q.id} className="px-3 py-2 font-normal" title={q.label}>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="grid size-4 place-items-center rounded text-white" style={{ background: colorOf(q.color) }}>
                        <CheckinIcon name={q.icon} size={10} />
                      </span>
                      <span className="max-w-[140px] truncate">{q.label}</span>
                      {q.cadence === "WEEKLY" && <span className="text-[10px]">· {t("Weekly").toLowerCase()}</span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const row = inRange.filter((a) => a.day === day);
                const { score } = readinessOf(columns, row);
                return (
                  <tr key={day} className="border-t border-border/60 bg-surface">
                    <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-1.5 text-muted">
                      {weekdayShort(weekdayOf(`${day}T00:00:00Z`))} {formatDate(day)}
                    </td>
                    {hasScale && (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {score === null ? (
                          <span className="text-muted-2">—</span>
                        ) : (
                          <span className={`rounded px-1.5 py-0.5 font-medium ${score <= LOW_READINESS ? "bg-warn/15 text-warn" : "text-foreground"}`}>
                            {score}
                          </span>
                        )}
                      </td>
                    )}
                    {columns.map((q) => {
                      const a = row.find((x) => x.questionId === q.id);
                      if (!a) {
                        return (
                          <td key={q.id} className="px-3 py-1.5 text-muted-2">
                            —
                          </td>
                        );
                      }
                      const s = scaleScore(q, a.value);
                      const low = s !== null && s <= 2;
                      return (
                        <td
                          key={q.id}
                          title={a.value ?? ""}
                          className={`max-w-[220px] truncate px-3 py-1.5 ${q.kind === "TEXT" ? "italic text-muted" : "tabular-nums"} ${low ? "font-medium text-warn" : ""}`}
                        >
                          {formatAnswer(q, a.value, yesNo)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
