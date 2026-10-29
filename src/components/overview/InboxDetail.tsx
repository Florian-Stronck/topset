"use client";

import Link from "next/link";
import { useState, useTransition, type RefObject } from "react";
import { answerAthleteMeeting, markChatRead, markMovesSeen, markReviewed, sendChatMessage, sendMessage, undoMove } from "@/app/tracking/actions";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { InboxItem } from "@/lib/inbox";

export const KIND_LABEL: Record<InboxItem["kind"], string> = {
  session: "SESSION",
  message: "MESSAGE",
  meeting: "MEETING",
  move: "MOVED",
  program: "PROGRAM",
  training: "TRAINING",
  wellness: "WELLNESS",
  weight: "WEIGHT",
  link: "CHECK-INS",
  pr: "PR",
};

/** What "done" means for an item, if it can be done from here: reviewed, read, seen. */
export function doneAction(item: InboxItem): (() => Promise<unknown>) | null {
  if (item.kind === "session" && item.session) return () => markReviewed([item.session!.dayId], true);
  if (item.kind === "message") return () => markChatRead(item.athleteId);
  if (item.kind === "move" && item.moveId) return () => markMovesSeen(item.athleteId, [item.moveId!]);
  return null;
}

const button = "rounded-lg border px-3 py-1.5 text-[12px] font-medium disabled:opacity-50";
const plain = `${button} border-border text-foreground hover:border-accent hover:text-accent`;
const primary = `${button} border-accent bg-accent text-white hover:opacity-90`;

function Kbd({ children }: { children: string }) {
  return <kbd className="ml-1.5 rounded border border-b-2 border-current px-1 font-mono text-[10px] opacity-60">{children}</kbd>;
}

/**
 * The item picked in the queue, with what it takes to clear it right here: a session's
 * sets against the plan with a note back, the messages with a reply, a moved session or a
 * meeting to answer — or the way to the page that fixes it.
 */
export function InboxDetail({
  item,
  replyRef,
  onCleared,
  onSnooze,
}: {
  item: InboxItem;
  replyRef: RefObject<HTMLTextAreaElement | null>;
  /** Called once the item is dealt with, so the queue can move on before the refresh lands. */
  onCleared: () => void;
  onSnooze: (forever?: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try {
        await work();
        setDraft("");
        onCleared();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("That didn't work."));
      }
    });
  const done = doneAction(item);
  const s = item.session;

  const reply =
    item.kind === "session" && s
      ? () => sendMessage(item.athleteId, s.dayId, s.ymd, draft)
      : item.kind === "message"
        ? async () => {
            await sendChatMessage(item.athleteId, draft);
            await markChatRead(item.athleteId);
          }
        : null;

  return (
    <section aria-label={t("Selected item")} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[15px] font-semibold">{item.athlete}</span>
            <span className="text-[10px] tracking-[0.14em] text-muted-2">{t(KIND_LABEL[item.kind])}</span>
          </div>
          {s && (
            <div className="mt-0.5 text-[12px] text-muted">
              {s.phase} · {t("week {n}", { n: s.week })} · {s.label} · {formatDate(s.ymd)} · {t("{done}/{of} sets", { done: s.done, of: s.prescribed })}
            </div>
          )}
        </div>
        <Link href={item.href} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent">
          {item.hrefLabel} →
        </Link>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {s ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] text-[12.5px]">
              <thead>
                <tr className="bg-surface-2 text-left text-[10px] tracking-[0.12em] text-muted-2">
                  <th className="px-3 py-1.5 font-normal">{t("EXERCISE")}</th>
                  <th className="px-3 py-1.5 font-normal">{t("PRESCRIBED")}</th>
                  <th className="px-3 py-1.5 font-normal">{t("LOGGED")}</th>
                  <th className="px-3 py-1.5 text-right font-normal">{t("VS PLAN")}</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((line) => (
                  <tr key={line.id} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2 font-medium">
                      {line.exercise}
                      {line.video && (
                        <Link href={item.href} className="ml-2 rounded bg-surface-3 px-1.5 py-px text-[10px] font-normal text-muted hover:text-accent">
                          ▶ {t("Video")}
                        </Link>
                      )}
                      {line.note && <div className="mt-1 text-[11.5px] font-normal italic text-muted">“{line.note}”</div>}
                    </td>
                    <td className="px-3 py-2 text-muted">{line.prescribed}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {line.sets.length === 0 ? (
                          <span className="text-muted-2">—</span>
                        ) : (
                          line.sets.map((set, i) => (
                            <span
                              key={i}
                              className={`rounded px-1.5 py-px text-[11.5px] tabular-nums ${
                                set.pr ? "bg-pr/15 text-pr" : set.over ? "bg-warn/15 text-warn" : "bg-surface-3 text-foreground"
                              }`}
                            >
                              {set.text}
                            </span>
                          ))
                        )}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        line.delta === null ? "text-muted-2" : Math.abs(line.delta) >= 1 ? "text-miss" : Math.abs(line.delta) >= 0.5 ? "text-warn" : "text-muted"
                      }`}
                    >
                      {line.delta === null ? "—" : line.delta > 0 ? `+${line.delta}` : line.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : item.message ? (
          <ul className="flex flex-col gap-1.5">
            {item.message.recent.map((m, i) => (
              <li
                key={i}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-snug ${m.mine ? "self-end bg-accent-soft" : "self-start bg-surface-2"}`}
              >
                {m.body}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] leading-relaxed">{item.text}</p>
        )}

        {reply && (
          <div className="mt-auto flex flex-col gap-2">
            <label htmlFor="inbox-reply" className="text-[10px] tracking-[0.14em] text-muted-2">
              {item.kind === "session" ? t("NOTE ON THIS SESSION — {name} SEES IT IN THE APP", { name: item.athlete.toUpperCase() }) : t("REPLY")}
            </label>
            <textarea
              id="inbox-reply"
              ref={replyRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim()) run(reply);
                if (e.key === "Escape") e.currentTarget.blur();
              }}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </div>
        )}

        {error && <p className="text-[12px] text-miss">{error}</p>}

        <div className={`flex flex-wrap items-center justify-end gap-2 ${reply ? "" : "mt-auto"}`}>
          <button type="button" className={plain} disabled={pending} onClick={() => onSnooze(item.kind === "pr")}>
            {item.kind === "pr" ? t("Dismiss") : t("Snooze till tomorrow")}
            <Kbd>S</Kbd>
          </button>
          {item.kind === "meeting" && item.meetingId && (
            <>
              <button type="button" className={plain} disabled={pending} onClick={() => run(() => answerAthleteMeeting(item.meetingId!, false))}>
                {t("Decline")}
              </button>
              <button type="button" className={primary} disabled={pending} onClick={() => run(() => answerAthleteMeeting(item.meetingId!, true))}>
                {t("Accept")}
              </button>
            </>
          )}
          {item.kind === "move" && item.moveId && (
            <button type="button" className={plain} disabled={pending} onClick={() => run(() => undoMove(item.moveId!))}>
              {t("Put it back")}
            </button>
          )}
          {reply && (
            <button type="button" className={plain} disabled={pending || !draft.trim()} onClick={() => run(reply)}>
              {item.kind === "session" ? t("Send note") : t("Send reply")}
            </button>
          )}
          {done && (
            <button type="button" className={primary} disabled={pending} onClick={() => run(done)}>
              {item.kind === "session" ? t("Mark reviewed") : item.kind === "message" ? t("Mark read") : t("Got it")}
              <Kbd>E</Kbd>
            </button>
          )}
          {!done && item.kind !== "meeting" && item.kind !== "pr" && (
            <Link href={item.href} className={primary}>
              {item.hrefLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
