"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { syncChat } from "@/app/sync-actions";
import { deleteMessage, editMessage, markChatRead, sendChatMessage } from "@/app/tracking/actions";
import { shortDate } from "@/lib/athlete-format";
import { useCommands, type Command } from "@/lib/commands";
import { formatMoment } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { MessageData } from "@/lib/queries";

/** How often an open chat on screen fetches new messages from the server. */
const POLL_MS = 2_000;

/**
 * The chat with one athlete: their messages on the left, the coach's on the right — session
 * feedback from Review among them, tagged with its session. Opening it reads the athlete's.
 */
export function ChatView({
  athlete,
  messages: initial,
  unread,
  hasLink,
}: {
  athlete: { id: string; name: string };
  messages: MessageData[];
  unread: number;
  hasLink: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [synced, setSynced] = useState(initial);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  // A refresh (the chat's own sync) brings the server's list.
  if (synced !== initial) {
    setSynced(initial);
    setMessages(initial);
  }

  useEffect(() => {
    if (unread > 0) void markChatRead(athlete.id).then(() => router.refresh());
  }, [athlete.id, unread, router]);

  useEffect(() => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      void syncChat()
        .then((news) => news && router.refresh())
        .finally(() => (busy = false));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const focusComposer = () => document.getElementById("chat-compose")?.focus();
  const commands = useMemo<Command[]>(
    () => [{ id: "chat-compose", group: "Tracking", title: t("Write to {name}", { name: athlete.name }), keywords: "chat message athlete", run: focusComposer }],
    [athlete.name],
  );
  useCommands("tracking-chat", commands);

  function submit() {
    const body = draft.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        if (editing) {
          const m = await editMessage(editing, body);
          setMessages((list) => list.map((x) => (x.id === m.id ? { ...m, label: x.label } : x)));
        } else {
          const m = await sendChatMessage(athlete.id, body);
          setMessages((list) => [...list, m]);
        }
        setDraft("");
        setEditing(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="mx-auto mt-5 max-w-[720px]">
      {messages.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted">
          {hasLink ? t("No messages yet. Write to {name}, or leave feedback on a session in Review.", { name: athlete.name }) : t("No check-in link yet — nothing will come in from the phone.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => {
            const mine = m.sender === "coach";
            return (
              <li key={m.id} className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                    mine ? "rounded-br-md bg-accent-soft text-foreground" : "rounded-bl-md border border-border bg-surface text-foreground"
                  }`}
                >
                  {m.dayId && (
                    <div className="mb-0.5 text-[10px] text-muted-2">
                      {shortDate(m.day)}
                      {m.label && ` · ${m.label}`}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
                <div className="mt-0.5 flex items-center gap-2 px-1 text-[10px] text-muted-2">
                  <span>{formatMoment(m.createdAt, true)}</span>
                  {mine && <span>{m.readAt ? t("read") : t("not read yet")}</span>}
                  {mine && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(m.id);
                          setDraft(m.body);
                          requestAnimationFrame(focusComposer);
                        }}
                        className="opacity-0 hover:text-accent group-hover:opacity-100"
                      >
                        {t("Edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMessages((list) => list.filter((x) => x.id !== m.id));
                          startTransition(() => deleteMessage(m.id));
                        }}
                        className="opacity-0 hover:text-miss group-hover:opacity-100"
                      >
                        {t("Delete")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div ref={end} />
      <div className="sticky bottom-0 mt-4 flex items-end gap-2 bg-background py-3">
        <textarea
          id="chat-compose"
          value={draft}
          rows={draft.includes("\n") ? 3 : 1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && editing) {
              setEditing(null);
              setDraft("");
            }
          }}
          placeholder={t("Write to {name}", { name: athlete.name })}
          className="min-h-9 flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none placeholder:text-muted-2 focus:border-accent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || pending}
          title={t("Ctrl+Enter")}
          className="h-9 shrink-0 rounded-lg bg-accent px-4 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {editing ? t("Save") : t("Send")}
        </button>
      </div>
      {error && <div className="text-[11px] text-miss">{error}</div>}
    </div>
  );
}
