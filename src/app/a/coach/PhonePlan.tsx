"use client";

import type { IntensityType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addRow, deleteRow, moveRow, updateCell, updateDay, updateRow } from "@/app/a/coach/actions";
import { PlanSheet, RulesSheet } from "@/app/a/coach/PlanSheets";
import { formatDate, weekdayOf } from "@/lib/dates";
import { volumeText } from "@/lib/duration";
import { t, weekdayShort } from "@/lib/i18n";
import { formatPrescription } from "@/lib/intensity";
import { dateOfDay } from "@/lib/schedule";
import type { BlockData, DayData, RowData } from "@/lib/types";

const field = "h-10 w-full min-w-0 rounded-lg border border-border bg-surface-2 px-2.5 text-[15px] outline-none focus:border-accent";

/** How intensity is written. A range or back-off set comes from the desktop; the phone only keeps it. */
const TYPE_LABEL: Record<IntensityType, string> = { RPE: "RPE", RIR: "RIR", PERCENT: "%", WEIGHT: "Weight", RANGE: "Range", BACKOFF: "Backoff" };
const PHONE_TYPES: IntensityType[] = ["RPE", "RIR", "PERCENT", "WEIGHT"];

/** A number typed on a phone: comma or point, empty for none. */
const numberOf = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));

/** Leaving a field saves it; so does the keyboard's Enter / Done. */
const enterLeaves = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();

/**
 * The plan on the coach's phone: one week of a phase, session by session, every exercise
 * opening to its sets, reps, intensity and notes. Each change is the desktop grid's own, so
 * week syncing and progression rules carry it forward the same way.
 */
export function PhonePlan({ athleteId, block, unit, initialWeek }: { athleteId: string; block: BlockData; unit: "KG" | "LB"; initialWeek: number }) {
  const router = useRouter();
  const [week, setWeek] = useState(Math.min(initialWeek, block.weeks.length));
  const [open, setOpen] = useState<string | null>(null);
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = block.weeks.find((w) => w.order === week) ?? block.weeks[0];

  function save(write: () => Promise<unknown>) {
    setError(null);
    start(async () => {
      try {
        await write();
        router.refresh();
      } catch (e) {
        setError(t(e instanceof Error ? e.message : "Something went wrong."));
      }
    });
  }

  if (!shown) return null;
  const rulesRow = rulesFor ? block.weeks.flatMap((w) => w.days.flatMap((d) => d.rows)).find((r) => r.id === rulesFor) : undefined;

  return (
    <div className="mt-4">
      <div role="group" aria-label={t("Week")} className="flex gap-1.5 overflow-x-auto pb-1">
        {block.weeks.map((w) => (
          <button
            key={w.id}
            type="button"
            aria-pressed={w.order === shown.order}
            onClick={() => setWeek(w.order)}
            className={`h-9 shrink-0 rounded-full border px-3.5 text-[13px] ${w.order === shown.order ? "border-accent text-accent" : "border-border text-muted"}`}
          >
            {t("Wk {n}", { n: w.order })}
            {w.locked && ` · ${t("Locked")}`}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-label={t("Weeks, phases and programs")}
          className="h-9 w-11 shrink-0 rounded-full border border-dashed border-border text-[18px] text-muted"
        >
          +
        </button>
      </div>
      {shown.locked && <p className="mt-2 text-[12px] text-muted">{t("Locked")}</p>}
      {error && <p className="mt-2 text-[13px] text-miss">{error}</p>}

      <div className={`mt-3 space-y-3 ${pending ? "opacity-70" : ""}`}>
        {shown.days.map((day) => (
          <Session
            key={day.id}
            day={day}
            date={dateOfDay(block.startDate, shown.order, day.index)}
            unit={unit}
            open={open}
            onOpen={(id) => setOpen(open === id ? null : id)}
            onRules={setRulesFor}
            save={save}
          />
        ))}
      </div>
      {sheet && <PlanSheet athleteId={athleteId} block={block} week={shown} onClose={() => setSheet(false)} />}
      {rulesRow && <RulesSheet row={rulesRow} block={block} onClose={() => setRulesFor(null)} />}
    </div>
  );
}

function Session({
  day,
  date,
  unit,
  open,
  onOpen,
  onRules,
  save,
}: {
  day: DayData;
  date: string;
  unit: "KG" | "LB";
  open: string | null;
  onOpen: (rowId: string) => void;
  onRules: (rowId: string) => void;
  save: (write: () => Promise<unknown>) => void;
}) {
  const [adding, setAdding] = useState("");
  const rows = [...day.rows].sort((a, b) => a.order - b.order);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex items-center gap-2 bg-surface-2 px-3 py-2">
        <span className="shrink-0 text-[12px] text-muted-2">
          {weekdayShort(weekdayOf(date))} {formatDate(date)}
        </span>
        <input
          key={day.label}
          defaultValue={day.label}
          aria-label={t("Session name")}
          onKeyDown={enterLeaves}
          onBlur={(e) => e.target.value.trim() && e.target.value !== day.label && save(() => updateDay(day.id, { label: e.target.value }))}
          className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[14px] font-semibold outline-none focus:bg-surface"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={day.rest} onChange={(e) => save(() => updateDay(day.id, { rest: e.target.checked }))} className="size-4 accent-[var(--accent)]" />
          {t("Rest")}
        </label>
      </header>

      {!day.rest && (
        <>
          <ul className="divide-y divide-border/60">
            {rows.map((row, i) => (
              <li key={row.id}>
                <button type="button" onClick={() => onOpen(row.id)} aria-expanded={open === row.id} className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{row.exercise || t("Exercise")}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-muted">
                    {volumeText(row)} @ {formatPrescription(row, unit)}
                  </span>
                </button>
                {open === row.id && <RowEditor key={rowKey(row)} row={row} first={i === 0} last={i === rows.length - 1} onRules={() => onRules(row.id)} save={save} />}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = adding.trim();
              setAdding("");
              save(() => addRow(day.id, name));
            }}
            className="flex gap-2 border-t border-border/60 px-3 py-2"
          >
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t("Exercise")} aria-label={t("Exercise")} className={field} />
            <button type="submit" className="h-10 shrink-0 rounded-lg border border-border px-3 text-[13px] text-muted">
              {t("Add exercise")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

/** A row's fields as they are now, so the editor starts over when the server changes them. */
const rowKey = (r: RowData) => [r.id, r.exercise, r.sets, r.reps, r.intensityType, r.intensity, r.coachNotes].join("|");

function RowEditor({
  row,
  first,
  last,
  onRules,
  save,
}: {
  row: RowData;
  first: boolean;
  last: boolean;
  onRules: () => void;
  save: (write: () => Promise<unknown>) => void;
}) {
  const types = PHONE_TYPES.includes(row.intensityType) ? PHONE_TYPES : [row.intensityType, ...PHONE_TYPES];
  const [type, setType] = useState<IntensityType>(row.intensityType);

  /** A number field: saved once left, if it changed and reads as a number. */
  const number = (key: "sets" | "reps" | "intensity", text: string) => {
    const v = numberOf(text);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return;
    if (v === row[key]) return;
    save(() => updateCell(row.id, { [key]: key === "intensity" ? v : v === null ? null : Math.round(v) }));
  };

  return (
    <div className="space-y-3 bg-surface-2/50 px-3 pb-3 pt-1">
      <label className="block text-[12px] text-muted">
        {t("Exercise")}
        <input
          defaultValue={row.exercise}
          onKeyDown={enterLeaves}
          onBlur={(e) => e.target.value.trim() && e.target.value !== row.exercise && save(() => updateRow(row.id, { exercise: e.target.value }))}
          className={`${field} mt-1`}
        />
      </label>
      <div className="grid grid-cols-[1fr_1fr_1.2fr_1fr] gap-2">
        <label className="text-[12px] text-muted">
          {t("Sets")}
          <input inputMode="numeric" defaultValue={row.sets ?? ""} onKeyDown={enterLeaves} onBlur={(e) => number("sets", e.target.value)} className={`${field} mt-1 text-center tabular-nums`} />
        </label>
        <label className="text-[12px] text-muted">
          {t("Reps")}
          <input inputMode="numeric" defaultValue={row.reps ?? ""} onKeyDown={enterLeaves} onBlur={(e) => number("reps", e.target.value)} className={`${field} mt-1 text-center tabular-nums`} />
        </label>
        <label className="text-[12px] text-muted">
          {t("Intensity")}
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value as IntensityType;
              setType(next);
              save(() => updateCell(row.id, { intensityType: next }));
            }}
            className={`${field} mt-1 px-1.5`}
          >
            {types.map((x) => (
              <option key={x} value={x}>
                {t(TYPE_LABEL[x])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-muted">
          &nbsp;
          <input inputMode="decimal" defaultValue={row.intensity ?? ""} aria-label={t("Intensity")} onKeyDown={enterLeaves} onBlur={(e) => number("intensity", e.target.value)} className={`${field} mt-1 text-center tabular-nums`} />
        </label>
      </div>
      <label className="block text-[12px] text-muted">
        {t("Coach notes")}
        <textarea
          defaultValue={row.coachNotes ?? ""}
          rows={2}
          onBlur={(e) => e.target.value !== (row.coachNotes ?? "") && save(() => updateCell(row.id, { coachNotes: e.target.value.trim() || null }))}
          className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-[15px] outline-none focus:border-accent"
        />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" disabled={first} onClick={() => save(() => moveRow(row.id, "up"))} aria-label={t("Move up")} className="h-9 rounded-lg border border-border px-3 text-[14px] text-muted disabled:opacity-40">
          ↑
        </button>
        <button type="button" disabled={last} onClick={() => save(() => moveRow(row.id, "down"))} aria-label={t("Move down")} className="h-9 rounded-lg border border-border px-3 text-[14px] text-muted disabled:opacity-40">
          ↓
        </button>
        <button type="button" onClick={onRules} className="h-9 rounded-lg border border-border px-3 text-[13px] text-muted">
          {t("Progression")}
          {row.rules.length > 0 && ` · ${row.rules.length}`}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => window.confirm(t("Delete {name}?", { name: row.exercise || t("Exercise") })) && save(() => deleteRow(row.id))}
          className="h-9 rounded-lg px-3 text-[13px] text-miss"
        >
          {t("Delete")}
        </button>
      </div>
    </div>
  );
}
