"use client";

import Link from "next/link";
import { useState } from "react";
import type { DayKind } from "@/lib/calendar";
import { t } from "@/lib/i18n";

export type CalendarCell = { ymd: string; day: number; inMonth: boolean; kind: DayKind };

/** How each kind of day is drawn: a filled chip, or for a missed day a ring only. */
const CHIP: Record<DayKind, string> = {
  plan: "bg-cal-plan text-black shadow-[inset_0_0_0_1px_var(--border)]",
  done: "bg-cal-done text-white",
  pr: "bg-cal-pr text-black",
  meet: "bg-cal-meet text-black",
  missed: "text-foreground shadow-[inset_0_0_0_1.5px_var(--cal-missed)]",
  none: "text-muted",
};

export const LEGEND: { kind: DayKind; label: string }[] = [
  { kind: "plan", label: "Training" },
  { kind: "done", label: "Done" },
  { kind: "pr", label: "PR" },
  { kind: "meet", label: "Competition" },
  { kind: "missed", label: "Missed" },
];

/**
 * A month of training at a glance. Tapping a day opens what happened on it underneath,
 * without a trip to the server: every day's card came with the page.
 */
export function HistoryCalendar({
  title,
  prev,
  next,
  thisMonth,
  weekdays,
  weeks,
  today,
  initial,
  details,
  empty,
}: {
  title: string;
  prev: string;
  next: string;
  /** Back to the month with today in it, when this isn't it. */
  thisMonth: string | null;
  weekdays: string[];
  weeks: CalendarCell[][];
  today: string;
  initial: string | null;
  /** What each day with anything on it holds, ready rendered. */
  details: Record<string, React.ReactNode>;
  /** Shown for a day with nothing on it. */
  empty: string;
}) {
  const [selected, setSelected] = useState(initial);

  return (
    <div>
      <div className="mt-4 flex items-center gap-1">
        <Link href={prev} aria-label={t("Previous month")} className="grid size-10 place-items-center rounded-full text-muted active:bg-surface-3">
          <Chevron d="M15 6l-6 6 6 6" />
        </Link>
        <h2 className="flex-1 text-center text-[16px] font-semibold capitalize">{title}</h2>
        <Link href={next} aria-label={t("Next month")} className="grid size-10 place-items-center rounded-full text-muted active:bg-surface-3">
          <Chevron d="M9 6l6 6-6 6" />
        </Link>
      </div>

      <div className="mt-2 rounded-2xl border border-border bg-surface p-2">
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-2">
          {weekdays.map((d, i) => (
            <span key={i} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {weeks.flat().map((cell) => {
            const isSelected = cell.ymd === selected;
            const isToday = cell.ymd === today;
            return (
              <button
                key={cell.ymd}
                type="button"
                onClick={() => setSelected(cell.ymd)}
                aria-pressed={isSelected}
                aria-label={cell.ymd}
                className={`mx-auto grid aspect-square w-full max-w-11 place-items-center rounded-xl ${
                  isSelected ? "bg-surface-3" : ""
                } ${cell.inMonth ? "" : "opacity-35"}`}
              >
                <span
                  className={`grid size-9 place-items-center rounded-full text-[14px] tabular-nums ${CHIP[cell.kind]} ${
                    isToday ? "font-bold outline-2 outline-offset-2 outline-accent" : ""
                  }`}
                >
                  {cell.day}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
        {LEGEND.map((l) => (
          <li key={l.kind} className="flex items-center gap-1.5">
            <span className={`size-3 rounded-full ${CHIP[l.kind]}`} />
            {t(l.label)}
          </li>
        ))}
      </ul>

      {thisMonth && (
        <div className="mt-3 text-center">
          <Link href={thisMonth} className="text-[13px] text-accent">
            {t("Back to this month")}
          </Link>
        </div>
      )}

      {selected && (
        <section className="mt-5" aria-live="polite">
          {details[selected] ?? <p className="rounded-2xl border border-border bg-surface px-4 py-4 text-center text-[13px] text-muted">{empty}</p>}
        </section>
      )}
    </div>
  );
}

function Chevron({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
