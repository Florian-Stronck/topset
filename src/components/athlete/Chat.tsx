"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { chatMessages, markRead, sendChat } from "@/app/a/actions";
import { shortDate } from "@/lib/athlete-format";
import type { InboxMessage } from "@/lib/athlete-queries";
import { t } from "@/lib/i18n";

/** How often the open chat looks for new messages while it's on screen. */
const POLL_MS = 2_000;

/**
 * The chat with the coach: theirs on the left — session notes tagged with the session and
 * linking to it — the athlete's on the right. Opening it reads the coach's; the ones that
 * were new stay picked out until the athlete leaves.
 */
export function Chat({ token, messages: initial }: { token: string; messages: InboxMessage[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [synced, setSynced] = useState(initial);
  const [fresh] = useState(() => new Set(initial.filter((m) => m.sender === "coach" && !m.read).map((m) => m.id)));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  if (synced !== initial) {
    setSynced(initial);
    setMessages(initial);
  }

  useEffect(() => {
    if (fresh.size > 0) void markRead(token, [...fresh]).then(() => router.refresh());
  }, [fresh, router, token]);

  // New coach messages that arrive while it's open count as read too.
  useEffect(() => {
    if (messages.some((m) => m.sender === "coach" && !m.read && !fresh.has(m.id))) void markRead(token);
  }, [messages, fresh, token]);

  // Just the messages, not the whole page: one small request while the chat is on screen.
  useEffect(() => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      void chatMessages(token)
        .then(setMessages, () => {})
        .finally(() => (busy = false));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [token]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function submit() {
    const body = draft.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const m = await sendChat(token, body);
        setMessages((list) => [...list, m]);
        setDraft("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const base = `/a/${token}`;
  const lastMine = messages.findLast((m) => m.sender === "athlete");

  return (
    <div>
      {messages.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">
          {t("Nothing yet. Write to your coach, or wait for their notes on your sessions.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => {
            const mine = m.sender === "athlete";
            const isNew = fresh.has(m.id);
            const bubble = `block max-w-[85%] rounded-2xl px-3.5 py-2 ${
              mine ? "rounded-br-md bg-accent text-white" : `rounded-bl-md border ${isNew ? "border-accent/50 bg-accent-soft" : "border-border bg-surface"}`
            }`;
            const tag = !mine && m.label !== null && (
              <div className="mb-0.5 flex items-baseline gap-2 text-[11px] text-muted-2">
                {isNew && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white">{t("New")}</span>}
                <span>
                  {shortDate(m.day)} · {m.label}
                </span>
              </div>
            );
            const text = <p className={`whitespace-pre-wrap text-[14px] leading-snug ${mine ? "" : "text-foreground"}`}>{m.body}</p>;
            return (
              <li key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                {!mine && m.label !== null ? (
                  <Link href={`${base}?d=${m.day}`} className={`${bubble} active:bg-surface-2`}>
                    {tag}
                    {text}
                  </Link>
                ) : (
                  <div className={bubble}>
                    {!mine && isNew && (
                      <span className="mb-0.5 inline-block rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white">{t("New")}</span>
                    )}
                    {text}
                  </div>
                )}
                {m === lastMine && <span className="mt-0.5 px-1 text-[10px] text-muted-2">{m.read ? t("Read") : t("Sent")}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div ref={end} />
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 mt-3 bg-background px-4 py-2">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            rows={Math.min(4, draft.split("\n").length)}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("Write a message…")}
            aria-label={t("Write a message…")}
            className="min-h-11 flex-1 resize-none rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[15px] outline-none placeholder:text-muted-2 focus:border-accent"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || pending}
            className="h-11 shrink-0 rounded-2xl bg-accent px-4 text-[14px] font-medium text-white active:opacity-80 disabled:opacity-40"
          >
            {t("Send")}
          </button>
        </div>
        {error && <div className="mt-1 text-[12px] text-miss">{error}</div>}
      </div>
    </div>
  );
}
