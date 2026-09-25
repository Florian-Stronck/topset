"use client";

import type { Unit } from "@prisma/client";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { loadBar, PLATE_SETS, plateColor } from "@/lib/plates";

const BARS: Record<Unit, number[]> = { KG: [20, 15, 10], LB: [45, 35, 25] };

/** Type a weight, see what goes on each side. */
export function PlateCalculator({ unit }: { unit: Unit }) {
  const set = PLATE_SETS[unit];
  const u = unit === "LB" ? "lb" : "kg";
  const [text, setText] = useState("");
  const [bar, setBar] = useState(set.bar);
  const [collars, setCollars] = useState(set.collars > 0);

  const target = Number(text.replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(target) && target > 0;
  const load = valid ? loadBar(target, { bar, collars: collars ? set.collars : 0, plates: set.plates }) : null;
  const biggest = set.plates[0];

  return (
    <section className="rounded-2xl border border-border bg-surface px-4 py-4">
      <h2 className="text-[15px] font-semibold">{t("Plate calculator")}</h2>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={t("Weight")}
          onChange={(e) => setText(e.target.value)}
          className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 text-[18px] tabular-nums outline-none focus:border-accent"
        />
        <span className="text-[14px] text-muted">{u}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">{t("Bar")}</span>
        {BARS[unit].map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBar(b)}
            className={`h-9 rounded-full border px-3 tabular-nums ${bar === b ? "border-accent text-accent" : "border-border text-muted"}`}
          >
            {b}
          </button>
        ))}
        {set.collars > 0 && (
          <label className="ml-auto flex h-9 items-center gap-2 text-muted">
            <input type="checkbox" checked={collars} onChange={(e) => setCollars(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            {t("Collars ({kg} kg)", { kg: set.collars })}
          </label>
        )}
      </div>

      {load && (
        <div className="mt-4">
          <div className="flex h-28 items-center" aria-hidden>
            <div className="h-3 w-10 rounded-l bg-surface-3" />
            {collars && set.collars > 0 && <div className="h-8 w-2 bg-muted-2" />}
            {load.perSide.map((p, i) => (
              <div
                key={i}
                className="mx-[1px] rounded-sm border border-black/30"
                style={{
                  background: plateColor(p, unit),
                  width: p >= biggest * 0.4 ? 14 : 9,
                  height: `${Math.max(28, Math.min(100, (p / biggest) * 100))}%`,
                }}
              />
            ))}
            <div className="h-3 flex-1 rounded-r bg-surface-3" />
          </div>

          <div className="mt-2 text-[14px]">
            <span className="text-muted">{t("Each side")}: </span>
            {load.perSide.length === 0 ? (
              <span>{t("empty bar")}</span>
            ) : (
              <span className="font-medium tabular-nums">{load.perSide.join(" + ")}</span>
            )}
          </div>
          {load.short > 0 && (
            <div className="mt-1 text-[13px] text-accent">
              {t("Closest is {total} {unit}, {short} short.", { total: load.total, unit: u, short: load.short })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
