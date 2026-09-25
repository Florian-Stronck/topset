"use client";

import type { Unit } from "@prisma/client";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { estimate1RM, percentOf1RM, roundToIncrement } from "@/lib/intensity";

const TABLE_RPE = [7, 8, 9, 10];
const TABLE_REPS = [1, 2, 3, 4, 5, 6, 8, 10];

/** Weight × reps @ RPE in, estimated max out — plus what that max means set by set. */
export function E1rmCalculator({ unit }: { unit: Unit }) {
  const u = unit === "LB" ? "lb" : "kg";
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState("");

  const num = (s: string) => {
    const n = Number(s.replace(",", "."));
    return s.trim() === "" || !Number.isFinite(n) ? null : n;
  };
  const w = num(weight);
  const r = num(reps);
  const e = num(rpe);
  const e1rm = w !== null && w > 0 && r !== null && r >= 1 ? estimate1RM(w, Math.round(r), e, unit) : null;

  return (
    <section className="rounded-2xl border border-border bg-surface px-4 py-4">
      <h2 className="text-[15px] font-semibold">{t("e1RM calculator")}</h2>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Field label={u} value={weight} onChange={setWeight} />
        <Field label={t("Reps")} value={reps} onChange={setReps} />
        <Field label={t("RPE")} value={rpe} onChange={setRpe} />
      </div>

      <div className="mt-4 text-center">
        {e1rm !== null ? (
          <>
            <div className="text-[12px] tracking-[0.16em] text-muted-2">{t("ESTIMATED 1RM")}</div>
            <div className="text-[34px] font-semibold tabular-nums">
              {e1rm} <span className="text-[18px] text-muted">{u}</span>
            </div>
          </>
        ) : (
          <div className="text-[13px] text-muted">
            {w !== null && r !== null && e === null
              ? t("Add the RPE for an estimate.")
              : t("Enter a set you did: weight, reps and RPE.")}
          </div>
        )}
      </div>

      {e1rm !== null && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-center text-[13px] tabular-nums">
            <thead className="bg-surface-2 text-[11px] text-muted-2">
              <tr>
                <th className="py-1.5 font-normal">{t("Reps")}</th>
                {TABLE_RPE.map((x) => (
                  <th key={x} className="py-1.5 font-normal">
                    @{x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TABLE_REPS.map((n) => (
                <tr key={n} className="border-t border-border">
                  <td className="py-1.5 text-muted">{n}</td>
                  {TABLE_RPE.map((x) => {
                    const pct = percentOf1RM(n, x);
                    return (
                      <td key={x} className="py-1.5">
                        {pct === null ? "—" : roundToIncrement((e1rm * pct) / 100, unit)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.1em] text-muted-2">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-12 w-full rounded-xl border border-border bg-surface-2 px-2 text-center text-[18px] tabular-nums outline-none focus:border-accent"
      />
    </label>
  );
}
