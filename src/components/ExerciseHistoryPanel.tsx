"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/dates";
import type { ExerciseHistory } from "@/lib/exercise-history";
import { t } from "@/lib/i18n";

const W = 1100;
const H = 140;
const PAD = { top: 12, right: 16, bottom: 20, left: 40 };
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };

/**
 * One exercise, every time it was logged, across every program: the estimated 1RM (or the
 * weight, where there's no estimate) as a line, and each session below it, newest first.
 */
export function ExerciseHistoryPanel({ history, unit }: { history: ExerciseHistory[]; unit: string }) {
  const [name, setName] = useState(history[0]?.name ?? "");
  // The palette's "Exercise history: …" picks one from outside.
  useEffect(() => {
    const pick = (e: Event) => setName(String((e as CustomEvent).detail));
    window.addEventListener("topset:exercise-history", pick);
    return () => window.removeEventListener("topset:exercise-history", pick);
  }, []);
  if (history.length === 0) return null;
  const current = history.find((h) => h.name === name) ?? history[0];

  return (
    <section className="mt-7">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("EXERCISE HISTORY")}</h2>
        <div className="flex items-center rounded-full border border-border bg-surface px-3 py-1">
          <select
            value={current.name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t("Exercise")}
            className="cursor-pointer bg-transparent text-[12px] outline-none"
          >
            {history.map((h) => (
              <option key={h.name} value={h.name}>
                {h.name} ({h.logs.length})
              </option>
            ))}
          </select>
        </div>
        <span className="text-[11px] text-muted-2">{t("every logged session, across all programs")}</span>
      </div>

      <div className="mt-2 rounded-xl border border-border bg-surface">
        {current.logs.length > 1 && <Line logs={current.logs} unit={unit} />}
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full text-left text-[12px] tabular-nums">
            <thead className="sticky top-0 bg-surface-2 text-[10px] tracking-[0.14em] text-muted-2">
              <tr>
                <th className="px-4 py-2 font-normal">{t("DATE")}</th>
                <th className="px-2 py-2 font-normal">{t("PROGRAM")}</th>
                <th className="px-2 py-2 font-normal">{t("PRESCRIBED")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("TARGET")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("TOP SET")}</th>
                <th className="px-4 py-2 text-right font-normal">{t("E1RM")}</th>
              </tr>
            </thead>
            <tbody>
              {[...current.logs].reverse().map((log, i) => (
                <tr key={`${log.ymd}-${i}`} className="border-t border-border/60">
                  <td className="px-4 py-1.5 text-muted">{formatDate(log.ymd, true)}</td>
                  <td className="px-2 py-1.5 text-muted-2">
                    {log.where} · {t("wk {n}", { n: log.week })}
                  </td>
                  <td className="px-2 py-1.5 text-muted">{log.prescribed}</td>
                  <td className="px-2 py-1.5 text-right text-muted-2">{log.target === null ? "—" : `${log.target} ${unit}`}</td>
                  <td className="px-2 py-1.5 text-right">
                    {log.weight} {unit}
                    {log.reps !== null && ` × ${log.reps}`}
                    {log.rpe !== null && <span className="text-muted"> @{log.rpe}</span>}
                  </td>
                  <td className="px-4 py-1.5 text-right">{log.e1rm === null ? "—" : `${log.e1rm} ${unit}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Line({ logs, unit }: { logs: ExerciseHistory["logs"]; unit: string }) {
  // The estimate where there is one; the weight lifted where not, so the line never breaks.
  const useE1rm = logs.every((l) => l.e1rm !== null);
  const points = logs.map((l) => ({ ymd: l.ymd, v: useE1rm ? l.e1rm! : l.weight }));
  const ms = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
  const t0 = ms(points[0].ymd);
  const t1 = Math.max(ms(points[points.length - 1].ymd), t0 + 86_400_000);
  const lo = Math.min(...points.map((p) => p.v));
  const hi = Math.max(...points.map((p) => p.v));
  const pad = Math.max(2.5, (hi - lo) * 0.15);
  const x = (ymd: string) => ((ms(ymd) - t0) / (t1 - t0)) * PLOT.w;
  const y = (v: number) => PLOT.h - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * PLOT.h;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ymd).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full border-b border-border" style={{ maxHeight: H }} role="img" aria-label={t("Exercise history")}>
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {[lo, hi].map((v) => (
          <g key={v}>
            <line x1={0} x2={PLOT.w} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={-6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--muted-2)">
              {v}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.ymd)} cy={y(p.v)} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5}>
            <title>{`${formatDate(p.ymd)} · ${p.v} ${unit}`}</title>
          </circle>
        ))}
        <text x={0} y={PLOT.h + 15} fontSize={10} fill="var(--muted-2)">
          {formatDate(points[0].ymd)}
        </text>
        <text x={PLOT.w} y={PLOT.h + 15} textAnchor="end" fontSize={10} fill="var(--muted-2)">
          {useE1rm ? t("estimated 1RM") : t("weight lifted")} · {formatDate(points[points.length - 1].ymd)}
        </text>
      </g>
    </svg>
  );
}
