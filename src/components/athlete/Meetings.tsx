"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { answerMeeting, cancelMeeting, changeMeeting, requestMeeting } from "@/app/a/schedule-actions";
import { shortDate } from "@/lib/athlete-format";
import { t } from "@/lib/i18n";
import { useTimeZone } from "@/lib/use-time-zone";
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

const field = "w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none placeholder:text-muted-2 focus:border-accent";

/**
 * Meetings with the coach, in the athlete app: the ones coming up, what each is waiting
 * on, and asking for a new one. `compact` is the Today screen's: that day's only, no form.
 */
export function Meetings({
  token,
  meetings,
  today,
  compact = false,
}: {
  token: string;
  meetings: MeetingData[];
  today: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<MeetingData | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const zone = useTimeZone();

  // Called off or declined stays in the list, dimmed, so the athlete sees what became of it.
  const shown = meetings.filter((m) => m.day >= today && (!compact || isUpcoming(m, today)));
  if (compact && shown.length === 0) return null;

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

  return (
    <section className={compact ? "mb-4" : "mb-6"}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("MEETINGS")}</h2>
        {!compact && editing === null && (
          <button type="button" onClick={() => setEditing("new")} className="text-[13px] font-medium text-accent">
            {t("Request a meeting")}
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
              () => (editing === "new" ? requestMeeting(token, input) : changeMeeting(token, editing.id, input)),
              () => setEditing(null),
            )
          }
        />
      )}
      {error && <p className="mb-2 text-[13px] text-miss">{error}</p>}

      {shown.length === 0 && editing === null ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted">
          {t("No meetings planned. Ask your coach for one when you want to talk.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((m) => {
            const link = placeLink(m.place);
            const waiting = waitingOn(m);
            const live = isUpcoming(m, today);
            const local = inZone(m, zone);
            const localEnd = local && timeSpan(local.time, m.minutes);
            return (
              <li
                key={m.id}
                className={`rounded-2xl border px-4 py-3 ${waiting === "athlete" ? "border-accent/50 bg-accent-soft" : "border-border bg-surface"} ${live ? "" : "opacity-60"}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[15px] font-medium">
                    {shortDate(m.day)} · <span className="tabular-nums">{timeSpan(m.time, m.minutes)}</span>
                  </div>
                  <StatusChip m={m} />
                </div>
                {local && (
                  <div className="mt-0.5 text-[12px] tabular-nums text-muted">
                    {t("Your time: {when}", { when: `${shortDate(local.day)} · ${localEnd}` })}
                  </div>
                )}
                {m.place &&
                  (link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-[13px] text-accent underline">
                      {m.place}
                    </a>
                  ) : (
                    <div className="mt-1 text-[13px] text-muted">{m.place}</div>
                  ))}
                {m.note && <p className="mt-1 whitespace-pre-wrap text-[13px] leading-snug">{m.note}</p>}
                {live && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {waiting === "athlete" && (
                      <>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => answerMeeting(token, m.id, true))}
                          className="h-9 rounded-full bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-50"
                        >
                          {t("Accept")}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => answerMeeting(token, m.id, false))}
                          className="h-9 rounded-full border border-border px-4 text-[13px] disabled:opacity-50"
                        >
                          {t("Decline")}
                        </button>
                      </>
                    )}
                    {!compact && (
                      <>
                        <button type="button" disabled={pending} onClick={() => setEditing(m)} className="h-9 px-2 text-[13px] text-muted">
                          {t("Other time")}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => cancelMeeting(token, m.id))}
                          className="h-9 px-2 text-[13px] text-muted"
                        >
                          {t("Call off")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusChip({ m }: { m: MeetingData }) {
  const waiting = waitingOn(m);
  const [label, cls] =
    m.status === "ACCEPTED"
      ? [t("Confirmed"), "bg-ok/20 text-ok-text"]
      : m.status === "CANCELLED"
        ? [t("Called off"), "bg-surface-3 text-muted"]
      : m.status === "DECLINED"
        ? [t("Declined"), "bg-surface-3 text-muted"]
        : waiting === "athlete"
          ? [t("Your answer?"), "bg-accent text-white"]
          : [t("Waiting for your coach"), "bg-surface-3 text-muted"];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
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
      className="mb-3 space-y-3 rounded-2xl border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ day, time, minutes, place, note, timeZone: zone });
      }}
    >
      <div className="text-[11px] tracking-[0.14em] text-muted-2">{initial ? t("SUGGEST ANOTHER TIME") : t("REQUEST A MEETING")}</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">{t("Day")}</span>
          <input type="date" required min={today} value={day} onChange={(e) => setDay(e.target.value)} className={`${field} h-12`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">{t("Time")}</span>
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={`${field} h-12`} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[13px] text-muted">{t("Length")}</span>
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={`${field} h-12`}>
          {MEETING_LENGTHS.map((n) => (
            <option key={n} value={n}>
              {t("{n} min", { n })}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] text-muted">{t("Where (place or video link)")}</span>
        <input
          type="text"
          maxLength={MAX_PLACE}
          value={place}
          placeholder={t("Optional")}
          onChange={(e) => setPlace(e.target.value)}
          className={`${field} h-12`}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] text-muted">{t("What about")}</span>
        <textarea
          rows={2}
          maxLength={MAX_MEETING_NOTE}
          value={note}
          placeholder={t("Optional")}
          onChange={(e) => setNote(e.target.value)}
          className={`${field} resize-none py-2`}
        />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-full border border-border text-[14px]">
          {t("Cancel")}
        </button>
        <button type="submit" disabled={pending || !day || !time} className="h-11 flex-1 rounded-full bg-accent text-[14px] font-medium text-white disabled:opacity-50">
          {t("Send")}
        </button>
      </div>
    </form>
  );
}
