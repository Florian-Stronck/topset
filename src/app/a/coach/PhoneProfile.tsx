"use client";

import { useState, useTransition } from "react";
import { updateAthlete, updateProfile } from "@/app/a/coach/actions";
import { t } from "@/lib/i18n";

const MAXES = [
  { key: "squat1RM", label: "Squat" },
  { key: "bench1RM", label: "Bench" },
  { key: "dead1RM", label: "Deadlift" },
] as const;

type Max = (typeof MAXES)[number]["key"];

const field = "h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px] outline-none focus:border-accent";

/**
 * The athlete's profile on the coach's phone: their 1RMs, the division they lift in and the
 * coach's notes. Each saves when the field is left. The rest of the profile is the desktop's.
 */
export function PhoneProfile({
  athlete,
}: {
  athlete: { id: string; unit: "KG" | "LB"; squat1RM: number | null; bench1RM: number | null; dead1RM: number | null; sex: string | null; notes: string | null };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";

  function save(write: () => Promise<void>) {
    setError(null);
    start(async () => {
      try {
        await write();
      } catch (e) {
        setError(t(e instanceof Error ? e.message : "Something went wrong."));
      }
    });
  }

  function saveMax(key: Max, text: string) {
    const v = text.trim() === "" ? null : Number(text.replace(",", "."));
    if (v !== null && !Number.isFinite(v)) return setError(t("That weight doesn't look right."));
    if (v === athlete[key]) return;
    save(() => updateAthlete(athlete.id, { [key]: v }));
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <section>
        <h2 className="text-[13px] font-semibold">{t("Maxes")}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t("Updates the athlete's record. This program keeps the maxes it was written against.")}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {MAXES.map((m) => (
            <label key={m.key} className="flex flex-col gap-1 text-[12px] text-muted">
              {t(m.label)} ({unit})
              <input
                type="text"
                inputMode="decimal"
                defaultValue={athlete[m.key] ?? ""}
                onBlur={(e) => saveMax(m.key, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={`${field} text-center tabular-nums`}
              />
            </label>
          ))}
        </div>
      </section>

      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        {t("Division")}
        <select
          defaultValue={athlete.sex ?? ""}
          onChange={(e) => save(() => updateProfile(athlete.id, { sex: e.target.value === "M" || e.target.value === "F" ? e.target.value : null }))}
          className={`${field} font-normal`}
        >
          <option value="">—</option>
          <option value="M">{t("Men")}</option>
          <option value="F">{t("Women")}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        {t("Notes")}
        <textarea
          defaultValue={athlete.notes ?? ""}
          rows={6}
          placeholder={t("Goals, history, anything to remember. Only you see this.")}
          onBlur={(e) => e.target.value !== (athlete.notes ?? "") && save(() => updateProfile(athlete.id, { notes: e.target.value }))}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[15px] font-normal leading-relaxed outline-none placeholder:text-muted-2 focus:border-accent"
        />
      </label>

      {pending && <p className="text-[12px] text-muted-2">{t("Saving…")}</p>}
      {error && <p className="text-[13px] text-miss">{error}</p>}
    </div>
  );
}
