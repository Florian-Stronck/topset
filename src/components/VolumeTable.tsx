"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { sortVolume, weeklyVolume, type VolumeSort } from "@/lib/volume";
import type { BlockData } from "@/lib/types";

/**
 * Sets per TARGET, week by week through the phase: every set written, with how many were
 * done under it. Any column header sorts; the week open below is picked out.
 */
export function VolumeTable({ block, activeWeek }: { block: BlockData; activeWeek: number }) {
  const [sort, setSort] = useState<VolumeSort>({ by: "target" });
  const [descending, setDescending] = useState(false);
  const rows = useMemo(() => weeklyVolume(block, { noTarget: t("No target"), chest: t("Chest"), legs: t("Legs") }), [block]);
  const sorted = sortVolume(rows, sort, descending);
  const weeks = block.weeks.map((w) => w.order);
  const peak = Math.max(1, ...rows.flatMap((r) => Object.values(r.weeks).map((c) => c.planned)));

  function sortBy(next: VolumeSort) {
    const same = JSON.stringify(next) === JSON.stringify(sort);
    // Names read A→Z first; numbers read biggest first.
    setDescending(same ? !descending : next.by !== "target");
    setSort(next);
  }

  const arrow = (s: VolumeSort) => (JSON.stringify(s) === JSON.stringify(sort) ? (descending ? " ↓" : " ↑") : "");

  if (rows.length === 0) return null;

  return (
    <section className="mt-7">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("WEEKLY SETS BY TARGET")}</h2>
        <span className="text-[11px] text-muted-2">
          {t("every set written, done under it · bench also counts for Chest, squat and deadlift for Legs")}
        </span>
      </div>

      <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="bg-surface-2 text-[10px] tracking-[0.14em] text-muted-2">
            <tr>
              <th className="px-4 py-2 text-left font-normal">
                <button type="button" onClick={() => sortBy({ by: "target" })} className="hover:text-foreground">
                  {t("TARGET")}
                  {arrow({ by: "target" })}
                </button>
              </th>
              {weeks.map((w) => (
                <th key={w} className={`px-2 py-2 text-right font-normal ${w === activeWeek ? "text-foreground" : ""}`}>
                  <button type="button" onClick={() => sortBy({ by: "week", week: w })} className="hover:text-foreground">
                    {t("WK {n}", { n: w })}
                    {arrow({ by: "week", week: w })}
                  </button>
                </th>
              ))}
              <th className="px-4 py-2 text-right font-normal">
                <button type="button" onClick={() => sortBy({ by: "total" })} className="hover:text-foreground">
                  {t("TOTAL")}
                  {arrow({ by: "total" })}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.target} className="border-t border-border/60">
                <td className="px-4 py-1.5">
                  {row.target}
                  {row.derived && (
                    <span className="ml-1.5 text-[10px] text-muted-2" title={t("Includes sets from bench, squat or deadlift rows")}>
                      +SBD
                    </span>
                  )}
                </td>
                {weeks.map((w) => {
                  const cell = row.weeks[w];
                  return (
                    <td key={w} className={`px-2 py-1.5 text-right ${w === activeWeek ? "bg-surface-2" : ""}`}>
                      {cell ? (
                        <div className="flex items-center justify-end gap-2">
                          <span
                            aria-hidden
                            className="h-1.5 rounded-full bg-accent/60"
                            style={{ width: `${Math.max(3, Math.round((cell.planned / peak) * 36))}px` }}
                          />
                          <span className="w-6">{cell.planned}</span>
                          <span className="w-6 text-[10px] text-muted-2" title={t("sets done")}>
                            {cell.done}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-2">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-1.5 text-right">
                  {row.total.planned}
                  <span className="ml-2 text-[10px] text-muted-2">{row.total.done}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
