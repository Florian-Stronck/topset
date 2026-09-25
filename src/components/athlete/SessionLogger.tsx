"use client";

import type { Unit } from "@prisma/client";
import { useState, useTransition } from "react";
import { logSet, logSets, removeSet, saveAthleteNotes, type SetPatch } from "@/app/a/actions";
import { Check } from "@/components/athlete/icons";
import type { AthleteRow, AthleteSession } from "@/lib/athlete-queries";
import { t } from "@/lib/i18n";
import { formatSet, type SetLogData } from "@/lib/setlog";

/** A number as typed on a phone: "82,5" is as good as "82.5"; blank is nothing. */
function parse(text: string): number | null {
  const n = Number(text.replace(",", ".").trim());
  return text.trim() === "" || !Number.isFinite(n) ? null : n;
}

const blank = (setIndex: number): SetLogData => ({
  id: `new-${setIndex}`,
  setIndex,
  weight: null,
  reps: null,
  rpe: null,
  rir: null,
  done: false,
  loggedAt: new Date().toISOString(),
});

type Effort = "RPE" | "RIR";
type SetEntry = { setIndex: number; patch: SetPatch };
const round = (n: number) => Math.round(n * 100) / 100;

function finishedRow(row: AthleteRow) {
  return row.logs.filter((l) => l.done).length >= Math.max(1, row.sets ?? 1);
}

/**
 * A day's exercises as a timeline. Each opens to its effort scale (RPE or RIR, per
 * exercise), a line of big fields per set — weight, reps, effort — and a note; the circle
 * ticks the whole exercise off in one tap.
 */
export function SessionLogger({
  token,
  unit,
  session,
  onProgress,
}: {
  token: string;
  unit: Unit;
  session: AthleteSession;
  /** Sets done and prescribed across the day, after every change. */
  onProgress?: (done: number, prescribed: number) => void;
}) {
  const [rows, setRows] = useState(session.rows);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = session.rows.find((r) => !finishedRow(r));
    return new Set(first ? [first.id] : []);
  });

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        await action();
        setError(null);
      } catch {
        setError(t("Couldn't save. Check your connection and try again."));
      }
    });
  }

  function update(next: AthleteRow[]) {
    setRows(next);
    onProgress?.(
      next.reduce((n, r) => n + r.logs.filter((l) => l.done).length, 0),
      next.reduce((n, r) => n + Math.max(1, r.sets ?? 1), 0),
    );
  }

  function applyLogs(rowId: string, sets: SetEntry[]) {
    update(
      rows.map((r) => {
        if (r.id !== rowId) return r;
        const logs = [...r.logs];
        for (const { setIndex, patch } of sets) {
          const at = logs.findIndex((l) => l.setIndex === setIndex);
          const merged = { ...(at >= 0 ? logs[at] : blank(setIndex)), ...patch } as SetLogData;
          if (at >= 0) logs[at] = merged;
          else logs.push(merged);
        }
        return { ...r, logs: logs.sort((a, b) => a.setIndex - b.setIndex) };
      }),
    );
  }

  function setLog(rowId: string, setIndex: number, patch: SetPatch) {
    applyLogs(rowId, [{ setIndex, patch }]);
    run(() => logSet(token, rowId, setIndex, patch));
  }

  function setAll(rowId: string, sets: SetEntry[]) {
    applyLogs(rowId, sets);
    run(() => logSets(token, rowId, sets));
  }

  function dropSet(rowId: string, setIndex: number) {
    update(
      rows.map((r) =>
        r.id !== rowId
          ? r
          : {
              ...r,
              logs: r.logs
                .filter((l) => l.setIndex !== setIndex)
                .map((l) => (l.setIndex > setIndex ? { ...l, setIndex: l.setIndex - 1 } : l)),
            },
      ),
    );
    run(() => removeSet(token, rowId, setIndex));
  }

  function setNotes(rowId: string, notes: string) {
    update(rows.map((r) => (r.id === rowId ? { ...r, athleteNotes: notes || null } : r)));
    run(() => saveAthleteNotes(token, rowId, notes));
  }

  function toggleOpen(rowId: string) {
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  return (
    <div className="mt-3">
      {error && (
        <div className="mb-3 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-[13px]">{error}</div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-5 py-6 text-center text-[13px] text-muted">
          {t("Nothing written for this day yet.")}
        </div>
      ) : (
        <ol className="relative">
          {/* The thread the exercises hang from, circle to circle. */}
          {rows.length > 1 && <span aria-hidden className="absolute bottom-8 left-[13px] top-4 w-[2px] rounded bg-accent/70" />}
          {rows.map((row) => (
            <ExerciseItem
              key={row.id}
              row={row}
              unit={unit}
              open={open.has(row.id)}
              onToggleOpen={() => toggleOpen(row.id)}
              onAll={(sets) => setAll(row.id, sets)}
              onLog={(i, patch) => setLog(row.id, i, patch)}
              onDrop={(i) => dropSet(row.id, i)}
              onNotes={(notes) => setNotes(row.id, notes)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function ExerciseItem({
  row,
  unit,
  open,
  onToggleOpen,
  onAll,
  onLog,
  onDrop,
  onNotes,
}: {
  row: AthleteRow;
  unit: Unit;
  open: boolean;
  onToggleOpen: () => void;
  onAll: (sets: SetEntry[]) => void;
  onLog: (setIndex: number, patch: SetPatch) => void;
  onDrop: (setIndex: number) => void;
  onNotes: (notes: string) => void;
}) {
  const [extra, setExtra] = useState(0);
  // RPE or RIR, for this exercise: however it was logged before, else however it is written.
  const [effort, setEffort] = useState<Effort>(() =>
    row.logs.some((l) => l.rir !== null)
      ? "RIR"
      : row.logs.some((l) => l.rpe !== null)
        ? "RPE"
        : row.prescription.startsWith("RIR")
          ? "RIR"
          : "RPE",
  );
  const u = unit === "LB" ? "lb" : "kg";
  const planned = Math.max(1, row.sets ?? 1);
  const logOf = (i: number) => row.logs.find((l) => l.setIndex === i) ?? null;
  const loads = row.loads.filter((l): l is number => l !== null);
  const loadOf = (i: number) => row.loads[i] ?? loads[loads.length - 1] ?? null;
  const target = loads.length === 0 ? null : loads[loads.length - 1];
  const finished = finishedRow(row);
  const doneLogs = row.logs.filter((l) => l.done);
  const lastLogged = row.logs.reduce((m, l) => Math.max(m, l.setIndex + 1), 0);
  const count = Math.max(planned, lastLogged + extra);

  /** Ticked off without anything typed means it went as written. */
  const asWritten = (i: number): SetPatch => {
    const log = logOf(i);
    return { done: true, weight: log?.weight ?? loadOf(i), reps: log?.reps ?? row.reps };
  };

  function toggleDone() {
    const sets = Array.from({ length: planned }, (_, i) => i);
    if (finished) return onAll(sets.map((i) => ({ setIndex: i, patch: { done: false } })));
    onAll(sets.filter((i) => !logOf(i)?.done).map((i) => ({ setIndex: i, patch: asWritten(i) })));
  }

  // Closed, a logged exercise lists its sets as done; otherwise it says what is asked.
  const summary = !open && doneLogs.length > 0 ? doneLogs.map((l) => formatSet(l)).join(" · ") : null;

  return (
    <li className="relative pb-6 pl-11 last:pb-1">
      <button
        type="button"
        onClick={toggleDone}
        aria-pressed={finished}
        aria-label={finished ? t("Mark set not done") : t("Mark set done")}
        className={`absolute left-0 top-0.5 z-10 grid h-7 w-7 place-items-center rounded-full ${
          finished ? "bg-accent text-white" : "border-2 border-border bg-background text-transparent"
        }`}
      >
        <Check size={14} />
      </button>

      <button type="button" onClick={onToggleOpen} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold leading-snug">{row.exercise}</h2>
          <div className="mt-0.5 text-[14px] tabular-nums">
            {summary !== null ? (
              <span className="text-muted">{summary}</span>
            ) : (
              <>
                <span>{row.sets ?? "—"}</span>
                <span className="text-muted"> × </span>
                <span>{row.reps ?? "—"}</span>
                <span className="text-muted"> @ </span>
                <span>{row.prescription}</span>
                {target !== null && row.prescription !== `${target} ${u}` && (
                  <span className="text-muted">
                    {" "}
                    · {target} {u}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="mt-1 shrink-0 text-muted"
        >
          <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </button>

      {open && (
        <div className="mt-2">
          {(row.ramp || row.tempo || row.restTime || row.videoUrl) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-2">
              {row.ramp && <span>{row.ramp}</span>}
              {row.tempo && (
                <span>
                  {t("Tempo")} {row.tempo}
                </span>
              )}
              {row.restTime && (
                <span>
                  {t("Rest")} {row.restTime}
                </span>
              )}
              {row.videoUrl && /^https?:\/\//.test(row.videoUrl) && (
                <a href={row.videoUrl} target="_blank" rel="noreferrer" className="text-accent">
                  {t("Video")}
                </a>
              )}
            </div>
          )}
          {row.coachNotes && <p className="mt-2 whitespace-pre-line text-[13px] italic text-muted">{row.coachNotes}</p>}

          <Label>{t("EFFORT")}</Label>
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface p-1">
            {(["RPE", "RIR"] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEffort(e)}
                aria-pressed={effort === e}
                className={`h-11 rounded-xl text-[14px] ${
                  effort === e ? "bg-surface-3 font-medium text-foreground" : "text-muted"
                }`}
              >
                {e}
              </button>
            ))}
          </div>

          <div className="mb-2 mt-4 grid grid-cols-[1fr_60px_60px_44px] gap-2 text-[11px] tracking-[0.14em] text-muted">
            <span>{t("WEIGHT")}</span>
            <span className="text-center">{t("REPS")}</span>
            <span className="text-center">{effort}</span>
            <span />
          </div>
          <div className="space-y-2">
            {Array.from({ length: count }, (_, i) => {
              const log = logOf(i);
              const isExtra = i >= planned;
              return (
                <SetRow
                  key={i}
                  index={i}
                  log={log}
                  load={loadOf(i)}
                  reps={row.reps}
                  unit={u}
                  effort={effort}
                  onLog={(patch) => onLog(i, patch)}
                  onTick={() => onLog(i, log?.done ? { done: false } : asWritten(i))}
                  onDrop={
                    isExtra
                      ? () => {
                          if (log) onDrop(i);
                          else setExtra((n) => Math.max(0, n - 1));
                        }
                      : null
                  }
                />
              );
            })}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setExtra((n) => n + 1)}
              className="h-10 rounded-full pr-2 text-[13px] text-accent active:bg-surface-3"
            >
              + {t("Add set")}
            </button>
            <span className="text-[12px] tabular-nums text-muted">
              {t("{done}/{of} sets", { done: doneLogs.length, of: planned })}
            </span>
          </div>

          <Label>{t("NOTE")}</Label>
          <NotesField value={row.athleteNotes} onCommit={onNotes} />
        </div>
      )}
    </li>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-4 text-[11px] tracking-[0.14em] text-muted">{children}</div>;
}

/**
 * One set, in the big fields: weight (with the set's number, or × on an extra set, in
 * front and the unit behind), reps, effort, and a round tick.
 */
function SetRow({
  index,
  log,
  load,
  reps,
  unit,
  effort,
  onLog,
  onTick,
  onDrop,
}: {
  index: number;
  log: SetLogData | null;
  load: number | null;
  reps: number | null;
  unit: string;
  effort: Effort;
  onLog: (patch: SetPatch) => void;
  onTick: () => void;
  onDrop: (() => void) | null;
}) {
  const done = log?.done ?? false;
  // Shown in this exercise's scale; saved in it, with the other one cleared.
  const other = effort === "RPE" ? log?.rir : log?.rpe;
  const own = effort === "RPE" ? log?.rpe : log?.rir;
  const shownEffort = own ?? (other === null || other === undefined ? null : round(10 - other));

  return (
    <div className="grid grid-cols-[1fr_60px_60px_44px] items-center gap-2">
      <BigNumber
        value={log?.weight ?? null}
        placeholder={load}
        done={done}
        suffix={unit}
        prefix={
          onDrop ? (
            <button type="button" onClick={onDrop} aria-label={t("Remove set")} className="mr-2 text-[15px] text-muted-2">
              ×
            </button>
          ) : (
            <span className="mr-2 text-[12px] tabular-nums text-muted-2">{index + 1}</span>
          )
        }
        onCommit={(v) => onLog({ weight: v })}
      />
      <BigNumber value={log?.reps ?? null} placeholder={reps} done={done} center onCommit={(v) => onLog({ reps: v })} />
      <BigNumber
        value={shownEffort}
        placeholder={null}
        done={done}
        center
        onCommit={(v) => onLog(effort === "RPE" ? { rpe: v, rir: null } : { rir: v, rpe: null })}
      />
      <button
        type="button"
        onClick={onTick}
        aria-pressed={done}
        aria-label={done ? t("Mark set not done") : t("Mark set done")}
        className={`grid h-11 w-11 place-items-center rounded-full border-2 ${
          done ? "border-ok bg-ok text-black" : "border-border text-muted-2"
        }`}
      >
        <Check size={16} />
      </button>
    </div>
  );
}

/** A big field, as typed on a phone: saved when left. */
function BigNumber({
  value,
  placeholder,
  done,
  prefix,
  suffix,
  center = false,
  onCommit,
}: {
  value: number | null;
  placeholder: number | null;
  done: boolean;
  prefix?: React.ReactNode;
  suffix?: string;
  center?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : String(value));

  function commit() {
    if (draft === null) return;
    const next = parse(draft);
    setDraft(null);
    if (next !== value) onCommit(next);
  }

  return (
    <label
      className={`flex h-14 min-w-0 items-center rounded-2xl border focus-within:border-accent ${center ? "px-1" : "px-3"} ${
        done ? "border-ok/40 bg-ok/10" : "border-border bg-surface"
      }`}
    >
      {prefix}
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        value={shown}
        placeholder={placeholder === null ? "—" : String(placeholder)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`min-w-0 flex-1 bg-transparent text-[18px] tabular-nums outline-none placeholder:text-muted-2 ${
          center ? "text-center" : ""
        }`}
      />
      {suffix && <span className="ml-1 text-[14px] text-muted">{suffix}</span>}
    </label>
  );
}

function NotesField({ value, onCommit }: { value: string | null; onCommit: (notes: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <textarea
      rows={3}
      value={draft ?? value ?? ""}
      placeholder={t("Add note…")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== (value ?? "")) onCommit(draft);
        setDraft(null);
      }}
      className="w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-[16px] outline-none placeholder:text-muted-2 focus:border-accent"
    />
  );
}
