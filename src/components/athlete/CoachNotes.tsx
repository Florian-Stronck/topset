"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { markRead } from "@/app/a/actions";
import { shortDate } from "@/lib/athlete-format";
import type { InboxMessage } from "@/lib/athlete-queries";
import { t } from "@/lib/i18n";

/**
 * The coach's notes, as cards. Opening them marks them read — the ones that were new stay
 * picked out until the athlete leaves, so they can still see what just came in.
 */
export function CoachNotes({
  token,
  messages,
  linkToSession = false,
  compact = false,
}: {
  token: string;
  messages: InboxMessage[];
  /** Each note links to the session it is about (the inbox); on a session it would link to itself. */
  linkToSession?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [fresh] = useState(() => new Set(messages.filter((m) => !m.read).map((m) => m.id)));

  useEffect(() => {
    if (fresh.size === 0) return;
    void markRead(token, [...fresh]).then(() => router.refresh());
  }, [fresh, router, token]);

  if (messages.length === 0) return null;
  const base = `/a/${token}`;

  return (
    <ul className={compact ? "space-y-2" : "space-y-3"}>
      {messages.map((m) => {
        const isNew = fresh.has(m.id);
        const body = (
          <>
            <div className="flex items-baseline gap-2 text-[11px] text-muted-2">
              {isNew && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white">{t("New")}</span>}
              <span>
                {shortDate(m.day)}
                {m.label && ` · ${m.label}`}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[14px] leading-snug text-foreground">{m.body}</p>
          </>
        );
        const cls = `block rounded-2xl border px-4 py-3 ${isNew ? "border-accent/50 bg-accent-soft" : "border-border bg-surface"}`;
        return (
          <li key={m.id}>
            {linkToSession ? (
              <Link href={`${base}?d=${m.day}`} className={`${cls} active:bg-surface-2`}>
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
