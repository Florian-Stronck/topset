"use client";

import Link from "next/link";
import { useState } from "react";
import { t } from "@/lib/i18n";

export type AthleteRow = {
  id: string;
  name: string;
  initials: string;
  program: string;
  unread: number;
  /** Days to their next meet, if one is set. */
  meetDays: number | null;
  meetName: string | null;
  shared: string | null;
  linked: boolean;
};

type Filter = "all" | "unread" | "meet";

/** The roster on the phone: search by name, narrow to who wrote in or has a meet coming. */
export function AthleteList({ rows }: { rows: AthleteRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const shown = rows.filter(
    (a) =>
      a.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === "all" || (filter === "unread" ? a.unread > 0 : a.meetDays !== null && a.meetDays <= 42)),
  );
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: t("All") },
    { id: "unread", label: t("Unread") },
    { id: "meet", label: t("Meet soon") },
  ];

  return (
    <div className="flex flex-col gap-3">
      <label className="flex h-11 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-muted">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder={t("Search athletes")}
          aria-label={t("Search athletes")}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-2"
        />
      </label>
      <div role="group" aria-label={t("Filter")} className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`h-9 rounded-full border px-4 text-[13px] ${filter === f.id ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[14px] text-muted">
          {rows.length === 0 ? t("No athletes yet. Add them in the desktop app; they show up here once it has synced.") : t("Nothing here with these filters.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((a) => (
            <li key={a.id}>
              <Link href={`/a/coach/${a.id}`} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 active:bg-surface-2">
                <span className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-[15px] font-semibold">{a.initials}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{a.name}</span>
                    <span className="block truncate text-[13px] text-muted">{a.program}</span>
                  </span>
                  {a.unread > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 text-[12px] font-bold text-white">{a.unread}</span>}
                </span>
                {(a.meetDays !== null || a.shared || !a.linked) && (
                  <span className="flex flex-wrap gap-1.5">
                    {a.meetDays !== null && (
                      <Tag dot="bg-warn">{t("{meet} in {n} d", { meet: a.meetName ?? t("Meet"), n: a.meetDays })}</Tag>
                    )}
                    {a.shared && <Tag dot="bg-muted-2">{a.shared}</Tag>}
                    {!a.linked && <Tag dot="bg-muted-2">{t("No check-in link yet")}</Tag>}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tag({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <span className="flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-[12px] text-muted">
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}
