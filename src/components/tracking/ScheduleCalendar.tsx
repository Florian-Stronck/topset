"use client";

import { useState } from "react";
import { dayMarks, monthGrid, shiftMonth } from "@/lib/calendar";
import { formatDate } from "@/lib/dates";
import { LOCALE, t, weekdayShort } from "@/lib/i18n";
import type { MeetingData } from "@/lib/meetings";
import type { MoveView } from "@/lib/queries";
import { useSettings } from "@/components/SettingsProvider";

/** A training day as the coach's calendar shows it. */
export type CalendarSession = {
  ymd: string;
  label: string;
  status: "done" | "missed" | "plan";
  /** Where the plan put it, when the athlete moved it here. */
  movedFrom: string | null;
};

const STATUS_CHIP: Record<CalendarSession["status"], string> = {
  done: "bg-cal-done/15 text-cal-done-text",
  missed: "bg-surface-3 text-muted line-through decoration-muted-2",
  plan: "bg-surface-3 text-foreground",
};

/**
 * A month of the athlete's training as it now stands: every session on the day it is done,
 * the days sessions were moved off (dashed) and onto (blue), and meetings. Stepping months
 * stays on this page; everything it needs came with it.
 */
export function ScheduleCalendar({
  today,
  sessions,
  moves,
  meetings,
}: {
  today: string;
  sessions: CalendarSession[];
  moves: MoveView[];
  meetings: MeetingData[];
}) {
  const { settings } = useSettings();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const weeks = monthGrid(month, settings.weekStart);
  const marks = dayMarks(moves, meetings);
  const byDay = new Map(sessions.map((s) => [s.ymd, s]));
  const meetingsOn = (ymd: string) => meetings.filter((m) => m.day === ymd && (m.status === "PROPOSED" || m.status === "ACCEPTED"));
  const title = new Date(`${month}-15T12:00:00Z`).toLocaleDateString(LOCALE[settings.language], { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <section className="mt-5">
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted-2">{t("CALENDAR")}</h2>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("Previous month")} className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-accent">
            <Chevron d="M15 6l-6 6 6 6" />
          </button>
          <span className="min-w-36 text-center text-[13px] font-medium capitalize">{title}</span>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("Next month")} className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-accent">
            <Chevron d="M9 6l6 6-6 6" />
          </button>
          {month !== current && (
            <button type="button" onClick={() => setMonth(current)} className="ml-1 rounded-lg px-2 py-1 text-[12px] text-accent hover:bg-surface-2">
              {t("Today")}
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-[11px] text-muted-2">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="px-2 py-1.5">
              {weekdayShort((settings.weekStart + i) % 7)}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map(({ ymd, inMonth }, i) => {
            const s = byDay.get(ymd);
            const mark = marks.get(ymd);
            const isToday = ymd === today;
            return (
              <div
                key={ymd}
                className={`min-h-24 space-y-1 border-border p-1.5 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${
                  inMonth ? "bg-surface" : "bg-background opacity-50"
                }`}
              >
                <div className={`text-[11px] tabular-nums ${isToday ? "inline-grid size-5 place-items-center rounded-full bg-accent font-semibold text-white" : "text-muted"}`}>
                  {Number(ymd.slice(8))}
                </div>
                {s && (
                  <div
                    title={s.movedFrom ? t("The athlete moved this session from {date}", { date: formatDate(s.movedFrom) }) : s.label}
                    className={`truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      s.movedFrom ? "bg-cal-moved/15 text-cal-moved ring-1 ring-cal-moved/60" : STATUS_CHIP[s.status]
                    }`}
                  >
                    {s.movedFrom && "↪ "}
                    {s.label}
                  </div>
                )}
                {s?.movedFrom && <div className="truncate text-[10px] text-cal-moved">{t("from {date}", { date: formatDate(s.movedFrom) })}</div>}
                {mark?.movedTo && !s && (
                  <div className="truncate rounded border border-dashed border-cal-moved px-1.5 py-0.5 text-[11px] text-cal-moved">
                    {t("moved to {date}", { date: formatDate(mark.movedTo) })}
                  </div>
                )}
                {meetingsOn(ymd).map((m) => (
                  <div
                    key={m.id}
                    title={m.place ?? undefined}
                    className={`truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      m.status === "ACCEPTED" ? "bg-cal-meeting text-white" : "bg-cal-meeting/15 text-cal-meeting ring-1 ring-cal-meeting/60"
                    }`}
                  >
                    {m.time} {t("Meeting")}
                    {m.status === "PROPOSED" && ` · ${t("proposed")}`}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <Legend cls={STATUS_CHIP.plan} label={t("Training")} />
        <Legend cls={STATUS_CHIP.done} label={t("Done")} />
        <Legend cls="bg-cal-moved/15 ring-1 ring-cal-moved/60" label={t("Moved here")} />
        <Legend cls="border border-dashed border-cal-moved" label={t("Moved away")} />
        <Legend cls="bg-cal-meeting" label={t("Meeting")} />
      </ul>
    </section>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`h-2.5 w-4 rounded-sm ${cls}`} />
      {label}
    </li>
  );
}

function Chevron({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
