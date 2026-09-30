"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveSession } from "@/app/a/schedule-actions";
import { shortDate } from "@/lib/athlete-format";
import { t } from "@/lib/i18n";
import { MAX_MOVE_DAYS, MAX_REASON } from "@/lib/moves";
import { addDays } from "@/lib/schedule";

const field = "w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none placeholder:text-muted-2 focus:border-accent";

/**
 * Moving the day's session to another day: a date, a reason for the coach, and the way
 * back to where the plan put it. Only offered before any set is checked off.
 */
export function MoveSession({
  token,
  dayId,
  ymd,
  movedFrom,
  today,
  canMove,
}: {
  token: string;
  dayId: string;
  ymd: string;
  /** Where the plan put it, when it was moved. */
  movedFrom: string | null;
  today: string;
  /** Nothing logged yet. */
  canMove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const planned = movedFrom ?? ymd;
  const earliest = addDays(planned, -MAX_MOVE_DAYS) > today ? addDays(planned, -MAX_MOVE_DAYS) : today;

  function go(target: string, why: string | null) {
    setError(null);
    start(async () => {
      try {
        await moveSession(token, dayId, target, why);
        setOpen(false);
        router.push(target === today ? `/a/${token}` : `/a/${token}?d=${target}`);
        router.refresh();
      } catch (e) {
        setError(t(e instanceof Error ? e.message : "Something went wrong."));
      }
    });
  }

  return (
    <div className="mt-3">
      {movedFrom && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-[13px]">
          <span className="text-muted">{t("Moved from {date}", { date: shortDate(movedFrom) })}</span>
          {canMove && movedFrom >= today && (
            <button type="button" disabled={pending} onClick={() => go(movedFrom, null)} className="shrink-0 font-medium text-accent disabled:opacity-50">
              {t("Move back")}
            </button>
          )}
        </div>
      )}
      {canMove && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-[13px] text-muted active:bg-surface-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM10 16h6M13 13l3 3-3 3" />
          </svg>
          {t("Reschedule this session")}
        </button>
      )}
      {open && (
        <form
          className="mt-2 space-y-3 rounded-2xl border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (to) go(to, reason);
          }}
        >
          <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("RESCHEDULE")}</div>
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">{t("New day")}</span>
            <input
              type="date"
              required
              value={to}
              min={earliest}
              max={addDays(planned, MAX_MOVE_DAYS)}
              onChange={(e) => setTo(e.target.value)}
              className={`${field} h-12`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">{t("Why (your coach sees this)")}</span>
            <textarea
              rows={2}
              maxLength={MAX_REASON}
              value={reason}
              placeholder={t("Optional")}
              onChange={(e) => setReason(e.target.value)}
              className={`${field} resize-none py-2`}
            />
          </label>
          {error && <p className="text-[13px] text-miss">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-11 flex-1 rounded-full border border-border text-[14px]">
              {t("Cancel")}
            </button>
            <button type="submit" disabled={!to || pending} className="h-11 flex-1 rounded-full bg-accent text-[14px] font-medium text-white disabled:opacity-50">
              {pending ? t("Moving…") : t("Move")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
