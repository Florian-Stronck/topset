"use client";

import type { Unit } from "@prisma/client";
import { useState, useTransition } from "react";
import { deleteBodyweight, logBodyweight } from "@/app/a/actions";
import { shortDate } from "@/lib/athlete-format";
import { bodyweightSummary, dailyWeights, type BodyweightEntry } from "@/lib/bodyweight";
import { t } from "@/lib/i18n";

/**
 * Bodyweight, one field at the top of Today: type it, save. The weigh-in goes on the day
 * being looked at (today, or a past day to catch up on), and the card opens to the last
 * few entries, each of which can be taken back.
 */
export function BodyweightCard({
  token,
  unit,
  day,
  today,
  entries: initial,
}: {
  token: string;
  unit: Unit;
  /** The day a new weigh-in is for. */
  day: string;
  today: string;
  /** Newest first. */
  entries: BodyweightEntry[];
}) {
  const u = unit === "LB" ? "lb" : "kg";
  const [entries, setEntries] = useState(initial);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const summary = bodyweightSummary(dailyWeights(entries), today);
  const onDay = entries.find((e) => e.day === day) ?? null;
  const value = Number(draft.replace(",", "."));
  const valid = draft.trim() !== "" && Number.isFinite(value) && value > 0;

  function save() {
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const entry = await logBodyweight(token, day, value);
        setEntries((was) => [entry, ...was]);
        setDraft("");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("That didn't save. Try again."));
      }
    });
  }

  function remove(id: string) {
    const before = entries;
    setEntries((was) => was.filter((e) => e.id !== id));
    startTransition(async () => {
      try {
        await deleteBodyweight(token, id);
      } catch {
        setEntries(before);
        setError(t("That didn't save. Try again."));
      }
    });
  }

  return (
    <section className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <div className="text-[11px] tracking-[0.14em] text-muted-2">
            {t("BODYWEIGHT")}
          </div>
          <div className="text-[13px] leading-snug text-muted">
            {onDay
              ? t("{w} {u} logged", { w: onDay.weight, u })
              : summary.latest
                ? t("Last {w} {u} · {date}", { w: summary.latest.weight, u, date: shortDate(summary.latest.day) })
                : t("Not logged yet")}
            {summary.change7 !== null && summary.change7 !== 0 && (
              <span className="text-muted-2">
                {" "}
                · {summary.change7 > 0 ? "+" : ""}
                {summary.change7} {t("this week")}
              </span>
            )}
          </div>
        </button>

        <label className="flex h-11 w-[108px] shrink-0 items-center rounded-xl border border-border bg-background px-2 focus-within:border-accent">
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            value={draft}
            placeholder={summary.latest ? String(summary.latest.weight) : "—"}
            aria-label={t("Bodyweight in {u}", { u })}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            className="min-w-0 flex-1 bg-transparent text-right text-[17px] tabular-nums outline-none placeholder:text-muted-2"
          />
          <span className="ml-1 text-[13px] text-muted">{u}</span>
        </label>
        <button
          type="button"
          onClick={save}
          disabled={!valid || pending}
          className="h-11 shrink-0 rounded-xl bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {t("Save")}
        </button>
      </div>

      {error && <div className="mt-2 text-[12px] text-accent">{error}</div>}

      {open && (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {entries.length === 0 && <li className="py-2 text-[13px] text-muted-2">{t("Nothing logged yet.")}</li>}
          {entries.slice(0, 14).map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2 text-[14px]">
              <span className="w-24 shrink-0 text-muted">{shortDate(e.day)}</span>
              <span className="flex-1 tabular-nums">
                {e.weight} {u}
                {e.source === "coach" && <span className="ml-2 text-[11px] text-muted-2">{t("by your coach")}</span>}
              </span>
              {e.source === "athlete" && (
                <button
                  type="button"
                  onClick={() => remove(e.id)}
                  aria-label={t("Delete")}
                  className="grid h-9 w-9 place-items-center rounded-full text-muted-2 active:bg-surface-3"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
