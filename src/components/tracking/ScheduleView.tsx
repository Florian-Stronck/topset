"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  answerAthleteMeeting,
  cancelCoachMeeting,
  deleteCoachMeeting,
  markMovesSeen,
  proposeMeeting,
  rescheduleMeeting,
  undoMove,
} from "@/app/tracking/actions";
import { formatDate, weekdayOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import {
  inZone,
  isUpcoming,
  MAX_MEETING_NOTE,
  MAX_PLACE,
  MEETING_LENGTHS,
  placeLink,
  timeSpan,
  waitingOn,
  type MeetingData,
  type MeetingInput,
} from "@/lib/meetings";
import type { MoveView } from "@/lib/queries";
import { ScheduleCalendar, type CalendarSession } from "@/components/tracking/ScheduleCalendar";
import { useTimeZone } from "@/lib/use-time-zone";

const field = "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] outline-none placeholder:text-muted-2 focus:border-accent";
const btn = "rounded-lg px-2.5 py-1.5 text-[12px]";

const when = (ymd: string) => `${weekdayShort(weekdayOf(ymd))} ${formatDate(ymd)}`;

/**
 * Schedule: the sessions the athlete moved to other days, and meetings with them. Opening
 * it marks the moves seen; the ones that were new stay picked out until the coach leaves.
 */
export function ScheduleView({
  athlete,
  today,
  moves,
  meetings,
  calendar,
}: {
  athlete: { id: string; name: string };
  today: string;
  moves: MoveView[];
  meetings: MeetingData[];
  /** Every training day, on the day it is done. */
  calendar: CalendarSession[];
}) {
  const router = useRouter();
  const [fresh] = useState(() => new Set(moves.filter((m) => m.seenAt === null).map((m) => m.id)));
  const [editing, setEditing] = useState<MeetingData | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (fresh.size > 0) void markMovesSeen(athlete.id, [...fresh]).then(() => router.refresh());
  }, [athlete.id, fresh, router]);

  function run(action: () => Promise<unknown>, after?: () => void) {
    setError(null);
    start(async () => {
      try {
        await action();
        after?.();
        router.refresh();
      } catch (e) {
        setError(t(e instanceof Error ? e.message : "Something went wrong."));
      }
    });
  }

  const upcoming = meetings.filter((m) => m.day >= today);
  const past = meetings.filter((m) => m.day < today).reverse();
  const shownMoves = moves.filter((m) => m.day >= today || m.fromDay >= today || fresh.has(m.id));

  return (
    <>
    <ScheduleCalendar today={today} sessions={calendar} moves={moves} meetings={meetings} />
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <section>
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted-2">{t("MOVED SESSIONS")}</h2>
        <p className="mt-1 text-[12px] text-muted">{t("Sessions {name} moved to another day in the athlete app. The plan itself is unchanged.", { name: athlete.name })}</p>
        {shownMoves.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted">{t("Nothing moved.")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shownMoves.map((m) => (
              <li key={m.id} className={`rounded-lg border px-3 py-2.5 ${fresh.has(m.id) ? "border-accent/50 bg-accent-soft" : "border-border bg-surface"}`}>
                <div className="flex items-center gap-2 text-[13px]">
                  {fresh.has(m.id) && <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">{t("New")}</span>}
                  <span className="font-medium">{m.label ?? t("Session")}</span>
                  {m.phase && (
                    <span className="text-[11px] text-muted">
                      {m.phase}
                      {m.week !== null && ` · ${t("Week {n}", { n: m.week })}`}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[12px] tabular-nums">
                  <span className="text-muted line-through">{when(m.fromDay)}</span>
                  <span className="mx-1.5 text-muted-2">→</span>
                  <span className="font-medium">{when(m.day)}</span>
                </div>
                {m.reason && <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted">“{m.reason}”</p>}
                <div className="mt-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => undoMove(m.id))}
                    title={t("Back to the day the plan has it on")}
                    className={`${btn} border border-border text-muted hover:border-accent hover:text-accent disabled:opacity-50`}
                  >
                    {t("Put back")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted-2">{t("MEETINGS")}</h2>
          {editing === null && (
            <button type="button" onClick={() => setEditing("new")} className={`${btn} bg-accent font-medium text-white hover:opacity-90`}>
              {t("Propose a meeting")}
            </button>
          )}
        </div>
        {editing !== null && (
          <MeetingForm
            initial={editing === "new" ? null : editing}
            today={today}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSave={(input) =>
              run(
                () => (editing === "new" ? proposeMeeting(athlete.id, input) : rescheduleMeeting(editing.id, input)),
                () => setEditing(null),
              )
            }
          />
        )}
        {error && <p className="mt-2 text-[12px] text-miss">{error}</p>}
        {upcoming.length === 0 && editing === null ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted">
            {t("No meetings coming up. Propose one, or {name} can ask from the athlete app.", { name: athlete.name })}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {upcoming.map((m) => (
              <MeetingRow
                key={m.id}
                m={m}
                today={today}
                pending={pending}
                onAnswer={(accept) => run(() => answerAthleteMeeting(m.id, accept))}
                onEdit={() => setEditing(m)}
                onCancel={() => run(() => cancelCoachMeeting(m.id))}
                onDelete={() => run(() => deleteCoachMeeting(m.id))}
              />
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <div className="mt-4">
            <button type="button" onClick={() => setShowPast((v) => !v)} className="text-[12px] text-muted hover:text-accent">
              {showPast ? t("Hide earlier meetings") : t("Earlier meetings ({n})", { n: past.length })}
            </button>
            {showPast && (
              <ul className="mt-2 space-y-2">
                {past.map((m) => (
                  <MeetingRow key={m.id} m={m} today={today} pending={pending} onDelete={() => run(() => deleteCoachMeeting(m.id))} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
    </>
  );
}

function MeetingRow({
  m,
  today,
  pending,
  onAnswer,
  onEdit,
  onCancel,
  onDelete,
}: {
  m: MeetingData;
  today: string;
  pending: boolean;
  onAnswer?: (accept: boolean) => void;
  onEdit?: () => void;
  onCancel?: () => void;
  onDelete: () => void;
}) {
  const link = placeLink(m.place);
  const waiting = waitingOn(m);
  const live = isUpcoming(m, today);
  const local = inZone(m, useTimeZone());
  const [label, cls] =
    m.status === "ACCEPTED"
      ? [t("Confirmed"), "bg-ok/20 text-ok-text"]
      : m.status === "CANCELLED"
        ? [t("Called off"), "bg-surface-3 text-muted"]
        : m.status === "DECLINED"
          ? [t("Declined"), "bg-surface-3 text-muted"]
          : waiting === "coach"
            ? [t("Asked by the athlete"), "bg-accent text-white"]
            : [t("Waiting for the athlete"), "bg-surface-3 text-muted"];

  return (
    <li className={`rounded-lg border px-3 py-2.5 ${waiting === "coach" && live ? "border-accent/50 bg-accent-soft" : "border-border bg-surface"} ${live ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium tabular-nums">
          {when(m.day)} · {timeSpan(m.time, m.minutes)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
      </div>
      {local && (
        <div className="mt-0.5 text-[11px] tabular-nums text-muted">
          {t("Your time: {when}", { when: `${when(local.day)} · ${timeSpan(local.time, m.minutes)}` })}
          {m.timeZone && <span className="text-muted-2"> · {t("set in {zone}", { zone: m.timeZone.replace(/_/g, " ") })}</span>}
        </div>
      )}
      {m.place &&
        (link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-[12px] text-accent underline">
            {m.place}
          </a>
        ) : (
          <div className="mt-1 text-[12px] text-muted">{m.place}</div>
        ))}
      {m.note && <p className="mt-1 whitespace-pre-wrap text-[12px]">{m.note}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {live && waiting === "coach" && onAnswer && (
          <>
            <button type="button" disabled={pending} onClick={() => onAnswer(true)} className={`${btn} bg-accent font-medium text-white disabled:opacity-50`}>
              {t("Accept")}
            </button>
            <button type="button" disabled={pending} onClick={() => onAnswer(false)} className={`${btn} border border-border disabled:opacity-50`}>
              {t("Decline")}
            </button>
          </>
        )}
        {live && onEdit && (
          <button type="button" disabled={pending} onClick={onEdit} className={`${btn} text-muted hover:text-accent`}>
            {t("Other time")}
          </button>
        )}
        {live && onCancel && (
          <button type="button" disabled={pending} onClick={onCancel} className={`${btn} text-muted hover:text-accent`}>
            {t("Call off")}
          </button>
        )}
        {!live && (
          <button type="button" disabled={pending} onClick={onDelete} className={`${btn} text-muted hover:text-miss`}>
            {t("Remove")}
          </button>
        )}
      </div>
    </li>
  );
}

function MeetingForm({
  initial,
  today,
  pending,
  onCancel,
  onSave,
}: {
  initial: MeetingData | null;
  today: string;
  pending: boolean;
  onCancel: () => void;
  onSave: (input: MeetingInput) => void;
}) {
  const [day, setDay] = useState(initial?.day ?? "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [minutes, setMinutes] = useState(initial?.minutes ?? 30);
  const [place, setPlace] = useState(initial?.place ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const zone = useTimeZone();

  return (
    <form
      className="mt-3 space-y-2 rounded-lg border border-border bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ day, time, minutes, place, note, timeZone: zone });
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        <label className="block text-[11px] text-muted">
          {t("Day")}
          <input type="date" required min={today} value={day} onChange={(e) => setDay(e.target.value)} className={`${field} mt-0.5`} />
        </label>
        <label className="block text-[11px] text-muted">
          {t("Time")}
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={`${field} mt-0.5`} />
        </label>
        <label className="block text-[11px] text-muted">
          {t("Length")}
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={`${field} mt-0.5`}>
            {MEETING_LENGTHS.map((n) => (
              <option key={n} value={n}>
                {t("{n} min", { n })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-[11px] text-muted">
        {t("Where (place or video link)")}
        <input type="text" maxLength={MAX_PLACE} value={place} onChange={(e) => setPlace(e.target.value)} className={`${field} mt-0.5`} />
      </label>
      <label className="block text-[11px] text-muted">
        {t("What about")}
        <textarea rows={2} maxLength={MAX_MEETING_NOTE} value={note} onChange={(e) => setNote(e.target.value)} className={`${field} mt-0.5 resize-none`} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${btn} text-muted hover:text-foreground`}>
          {t("Cancel")}
        </button>
        <button type="submit" disabled={pending || !day || !time} className={`${btn} bg-accent font-medium text-white disabled:opacity-50`}>
          {initial ? t("Propose new time") : t("Send to athlete")}
        </button>
      </div>
    </form>
  );
}
