"use client";

import { useRef, useState } from "react";
import { NumberInput } from "@/components/cells";
import { curveAt, curveHandles, smoothCurve, tableFromCurve, type CurveHandle } from "@/lib/intensity";
import { t } from "@/lib/i18n";
import { activeSettings, type RpeTable } from "@/lib/settings";

const HEAD_W = 64;
const HEAD_H = 26;
/** Narrowest a column gets before the chart scrolls sideways instead. */
const CELL_MIN = 40;
const CELL_H = 30;

/**
 * An RPE chart as a heatmap, with its curve laid over it: drag a handle to make that part
 * of the curve heavier or lighter and every cell follows; type into a cell to fix just it.
 * `base` (the coach's chart, on an athlete) is drawn dashed and marks where this one differs.
 */
export function RpeChartEditor({
  table,
  base,
  onChange,
}: {
  table: RpeTable;
  base?: RpeTable;
  onChange: (table: RpeTable) => void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  // While dragging, the handles live here; the chart is only saved on release.
  const [dragging, setDragging] = useState<{ index: number; handles: CurveHandle[]; from: CurveHandle[] } | null>(null);

  const handles = dragging?.handles ?? curveHandles(table);
  const shown = dragging ? tableFromCurve(table, dragging.handles, dragging.from) : table;
  const lo = handles[0].x;
  const hi = handles[handles.length - 1].x;
  const all = [...shown.pct.flat(), ...(base?.pct.flat() ?? [])];
  const floor = Math.floor(Math.min(...all) / 5) * 5 - 5;

  const left = (x: number) => ((x - lo) / (hi - lo)) * 100;
  const top = (y: number) => ((100 - y) / (100 - floor)) * 100;
  const line = (f: (x: number) => number | null) => {
    let d = "";
    for (let x = lo; x <= hi + 1e-9; x += (hi - lo) / 60) {
      const y = f(x);
      if (y !== null) d += `${d ? "L" : "M"}${left(x).toFixed(2)} ${top(y).toFixed(2)}`;
    }
    return d;
  };

  function move(e: React.PointerEvent) {
    if (!dragging || !overlay.current) return;
    const rect = overlay.current.getBoundingClientRect();
    const y = 100 - ((e.clientY - rect.top) / rect.height) * (100 - floor);
    const i = dragging.index;
    const above = dragging.handles[i - 1].y - 0.5;
    const below = i < dragging.handles.length - 1 ? dragging.handles[i + 1].y + 0.5 : floor;
    const next = dragging.handles.map((h, j) => (j === i ? { ...h, y: Math.max(below, Math.min(above, y)) } : h));
    setDragging({ ...dragging, handles: next });
  }

  function release() {
    if (!dragging) return;
    // A click (or the two of a double-click) that didn't move anything saves nothing.
    if (dragging.handles.some((h, i) => h.y !== dragging.from[i].y)) onChange(tableFromCurve(table, dragging.handles, dragging.from));
    setDragging(null);
  }

  /** Moves a handle by `by` percent from the keyboard, as far as its neighbours allow. */
  function nudge(i: number, by: number) {
    const above = handles[i - 1].y - 0.5;
    const below = i < handles.length - 1 ? handles[i + 1].y + 0.5 : floor;
    const next = handles.map((h, j) => (j === i ? { ...h, y: Math.max(below, Math.min(above, h.y + by)) } : h));
    if (next[i].y !== handles[i].y) onChange(tableFromCurve(table, next, handles));
  }

  /** Puts a handle back where the reference chart has it, as far as its neighbours allow. */
  function resetHandle(i: number) {
    const target = base ? curveAt(base, handles[i].x) : null;
    if (i === 0 || target === null) return;
    const above = handles[i - 1].y - 0.5;
    const below = i < handles.length - 1 ? handles[i + 1].y + 0.5 : floor;
    const next = handles.map((h, j) => (j === i ? { ...h, y: Math.max(below, Math.min(above, target)) } : h));
    if (next[i].y !== handles[i].y) onChange(tableFromCurve(table, next, handles));
  }

  const setCell = (r: number, c: number, v: number | null) => {
    if (v === null || !(v > 0 && v <= 100)) return;
    onChange({ ...table, pct: table.pct.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  };
  const comma = (n: number) => String(n).replace(".", activeSettings().language === "en" ? "." : ",");

  return (
    <div className="overflow-x-auto">
      <div className="relative select-none" style={{ minWidth: HEAD_W + CELL_MIN * table.reps.length }}>
        <table className="w-full border-separate border-spacing-0 text-[11px]" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr style={{ height: HEAD_H }}>
              <th style={{ width: HEAD_W }} className="px-1.5 text-left font-normal text-muted-2">
                {t("Reps")}
              </th>
              {shown.reps.map((reps) => (
                <th key={reps} className="font-normal text-muted-2">
                  {reps}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.rpe.map((rpe, r) => (
              <tr key={rpe} style={{ height: CELL_H }}>
                <th className="whitespace-nowrap px-1.5 text-left font-normal text-muted-2">RPE {comma(rpe)}</th>
                {shown.reps.map((reps, c) => {
                  const pct = shown.pct[r][c];
                  const was = base?.pct[r]?.[c];
                  const diff = was === undefined ? 0 : pct - was;
                  // Heavier cells deeper: the chart reads as a heatmap at a glance.
                  const heat = Math.round(4 + ((pct - floor) / (100 - floor)) ** 1.5 * 70);
                  return (
                    <td
                      key={reps}
                      title={was !== undefined && diff !== 0 ? t("Coach's chart: {pct}%", { pct: was }) : undefined}
                      className="relative border-b border-r border-background p-0"
                      style={{ background: `color-mix(in srgb, var(--accent) ${heat}%, transparent)` }}
                    >
                      <NumberInput value={pct} align="center" onCommit={(v) => setCell(r, c, v)} className="!px-0 !text-[11px]" />
                      {Math.abs(diff) >= 0.5 && (
                        <span
                          aria-hidden
                          className={`pointer-events-none absolute right-0.5 top-0 text-[8px] leading-none ${diff > 0 ? "text-[color:var(--ok)]" : "text-[color:var(--warn)]"}`}
                        >
                          {diff > 0 ? "▲" : "▼"}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* The curve over the cells: only the handles take the pointer, so cells stay typeable. */}
        <div
          ref={overlay}
          className="pointer-events-none absolute"
          style={{
            // From the middle of the first cell to the middle of the last, however wide they are.
            left: `calc(${HEAD_W}px + (100% - ${HEAD_W}px) / ${2 * shown.reps.length})`,
            right: `calc((100% - ${HEAD_W}px) / ${2 * shown.reps.length})`,
            top: HEAD_H + CELL_H / 2,
            bottom: CELL_H / 2,
          }}
        >
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            {base && (
              <path
                d={line((x) => curveAt(base, x))}
                fill="none"
                stroke="var(--muted)"
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path d={line(smoothCurve(handles))} fill="none" stroke="var(--foreground)" strokeOpacity={0.85} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
          {handles.map((h, i) => (
            <button
              key={i}
              type="button"
              disabled={i === 0}
              aria-label={t("Drag or use ↑/↓ to change {n} reps to failure", { n: Math.round(h.x) })}
              title={
                i === 0
                  ? t("A single at RPE 10 is the 1RM")
                  : `${Math.round(h.y * 2) / 2}%${base ? ` · ${t("double-click to put it back")}` : ""}`
              }
              onPointerDown={(e) => {
                if (i === 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging({ index: i, handles, from: handles });
              }}
              onDoubleClick={() => resetHandle(i)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" || e.key === "Delete") {
                  e.preventDefault();
                  resetHandle(i);
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  nudge(i, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 2.5 : 0.5));
                }
              }}
              onPointerMove={move}
              onPointerUp={release}
              onPointerCancel={release}
              className={`pointer-events-auto absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-surface ${
                i === 0 ? "cursor-default opacity-60" : "cursor-ns-resize hover:scale-125"
              }`}
              style={{ left: `${left(h.x)}%`, top: `${top(h.y)}%` }}
            />
          ))}
          {dragging && (
            <span
              className="absolute -translate-x-1/2 rounded bg-foreground px-1 text-[10px] font-medium text-background"
              style={{
                left: `${left(dragging.handles[dragging.index].x)}%`,
                top: `calc(${top(dragging.handles[dragging.index].y)}% - 22px)`,
              }}
            >
              {Math.round(dragging.handles[dragging.index].y * 2) / 2}%
            </span>
          )}
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-muted-2">
        {t("Drag the points on the line: left is heavy singles, right is high reps at low RPE. Double-click a point to put it back. Type in a cell to fix just that one.")}
      </div>
    </div>
  );
}
