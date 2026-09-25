"use client";

import { useRef, useState } from "react";
import { saveReadiness } from "@/app/a/actions";
import { t } from "@/lib/i18n";
import { READINESS_FIELDS, readinessScore, type ReadinessEntry, type ReadinessKey } from "@/lib/readiness";

type Values = Pick<ReadinessEntry, ReadinessKey | "note">;

const EMPTY: Values = { sleep: null, stress: null, soreness: null, energy: null, note: null };

/**
 * The readiness check-in, on the days the coach asks for it: a row of 1–5 taps for each
 * question and a note. Each tap saves on its own; once all four are in, the card folds to
 * a one-line summary that opens again to change an answer.
 */
export function ReadinessCard({
  token,
  day,
  initial,
}: {
  token: string;
  day: string;
  initial: ReadinessEntry | null;
}) {
  const [values, setValues] = useState<Values>(initial ?? EMPTY);
  const complete = READINESS_FIELDS.every((f) => values[f.key] !== null);
  const [open, setOpen] = useState(!complete);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One save at a time, in tap order: two quick taps must not race to create the day.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function save(patch: Partial<Values>) {
    setError(null);
    setValues((v) => ({ ...v, ...patch }));
    queue.current = queue.current
      .then(() => saveReadiness(token, day, patch))
      .catch((e) => setError(e instanceof Error ? e.message : t("That didn't save. Try again.")));
  }

  function tap(key: ReadinessKey, n: number) {
    const next = { ...values, [key]: values[key] === n ? null : n };
    save({ [key]: next[key] });
    // The last answer folds the card away.
    if (READINESS_FIELDS.every((f) => next[f.key] !== null) && !complete) setOpen(false);
  }

  const score = readinessScore(values);

  return (
    <section className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-[0.14em] text-muted-2">
            {t("READINESS")}
          </div>
          <div className="text-[13px] text-muted">
            {complete
              ? READINESS_FIELDS.map((f) => `${t(f.label)} ${values[f.key]}`).join(" · ")
              : t("How are you feeling before training?")}
          </div>
        </div>
        {score !== null && (
          <span className="shrink-0 text-[20px] font-semibold tabular-nums">
            {score}
            <span className="text-[12px] font-normal text-muted">/5</span>
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {READINESS_FIELDS.map((f) => (
            <div key={f.key}>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="font-medium">{t(f.label)}</span>
                <span className="text-[11px] text-muted-2">
                  1 {t(f.low)} · 5 {t(f.high)}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t(f.label)}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = values[f.key] === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => tap(f.key, n)}
                      className={`h-11 rounded-xl text-[15px] font-medium tabular-nums ${
                        on ? "bg-accent text-white" : "border border-border bg-background text-muted active:bg-surface-3"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <textarea
            rows={2}
            value={note ?? values.note ?? ""}
            placeholder={t("Anything your coach should know? (optional)")}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== null && note !== (values.note ?? "")) save({ note: note || null });
              setNote(null);
            }}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted-2 focus:border-accent"
          />
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-accent">{error}</div>}
    </section>
  );
}
