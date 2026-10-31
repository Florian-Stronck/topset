"use client";

import type { ProgField } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPhase, addRule, addWeek, createProgram, deleteRule, deleteWeek, duplicateWeek, updateRule } from "@/app/a/coach/actions";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { volumeText } from "@/lib/duration";
import { t } from "@/lib/i18n";
import { formatPrescription } from "@/lib/intensity";
import { describeRule } from "@/lib/progression";
import type { BlockData, RowData } from "@/lib/types";

/** A sheet that slides up over the page; a tap above it closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/55" role="dialog" aria-label={title}>
      <button type="button" aria-label={t("Close")} onClick={onClose} className="min-h-16 flex-1" />
      <div className="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-3xl bg-surface px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-3">
        <span aria-hidden className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border" />
        <span className="text-[17px] font-semibold">{title}</span>
        {children}
      </div>
    </div>
  );
}

function Stepper({ label, value, onDown, onUp }: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-muted">{label}</span>
      <div className="flex items-center rounded-xl border border-border bg-background">
        <button type="button" aria-label={t("Less")} onClick={onDown} className="size-11 text-[20px]">
          −
        </button>
        <span className="flex-1 text-center text-[17px] font-semibold tabular-nums">{value}</span>
        <button type="button" aria-label={t("More")} onClick={onUp} className="size-11 text-[20px]">
          +
        </button>
      </div>
    </div>
  );
}

const FIELDS: { id: ProgField; label: string; step: number }[] = [
  { id: "SETS", label: "Sets", step: 1 },
  { id: "REPS", label: "Reps", step: 1 },
  { id: "INTENSITY", label: "Intensity", step: 0.5 },
  { id: "LOAD", label: "Weight", step: 2.5 },
];

/**
 * A row's progression rules on the phone: what they make of it week by week, each rule
 * switched on or off or deleted, and a new one added with steppers. The rules are the
 * desktop's; the week syncing and projecting happen on the server as there.
 */
export function RulesSheet({ row, block, onClose }: { row: RowData; block: BlockData; onClose: () => void }) {
  const router = useRouter();
  const [field, setField] = useState<ProgField>("LOAD");
  const [amount, setAmount] = useState(2.5);
  const [every, setEvery] = useState(1);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const step = FIELDS.find((f) => f.id === field)!.step;

  // The same exercise in each week: the row in the same slot of the same day.
  const head = block.weeks.flatMap((w) => w.days.map((d) => ({ w, d }))).find(({ d }) => d.rows.some((r) => r.id === row.id));
  const chain = block.weeks.map((w) => {
    const r = w.days.find((d) => d.index === head?.d.index)?.rows.find((x) => x.order === row.order);
    // A weight rule writes `load`, beside the intensity as written.
    return { week: w.order, text: r ? `${volumeText(r)} @ ${formatPrescription(r, "KG")}${r.load !== null ? ` · ${r.load} kg` : ""}` : "—" };
  });

  function run(write: () => Promise<unknown>) {
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

  return (
    <Sheet title={`${t("Progression")} · ${row.exercise}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-1.5">
        {chain.map((c) => (
          <div key={c.week} className="rounded-xl border border-border bg-background px-3 py-2">
            <span className="block text-[11px] text-muted">{t("Wk {n}", { n: c.week })}</span>
            <span className="block truncate text-[13px] font-semibold tabular-nums">{c.text}</span>
          </div>
        ))}
      </div>

      {row.rules.length > 0 && (
        <ul className="flex flex-col gap-2">
          {row.rules.map((rule) => (
            <li key={rule.id} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border px-3.5">
              <span className="min-w-0 flex-1 text-[15px] font-semibold">{describeRule(rule, row.intensityType)}</span>
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                aria-label={t("On")}
                onClick={() => run(() => updateRule(rule.id, { enabled: !rule.enabled }))}
                className={`relative h-8 w-13 shrink-0 rounded-full ${rule.enabled ? "bg-ok" : "bg-surface-3"}`}
              >
                <span className={`absolute top-1 size-6 rounded-full bg-white transition-all ${rule.enabled ? "left-6" : "left-1"}`} />
              </button>
              <button type="button" onClick={() => run(() => deleteRule(rule.id))} className="shrink-0 text-[13px] text-miss">
                {t("Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <span className="mt-2 text-[12px] font-semibold tracking-[0.12em] text-muted">{t("NEW RULE")}</span>
      <div role="group" aria-label={t("Change")} className="grid grid-cols-4 rounded-xl border border-border bg-background p-[3px]">
        {FIELDS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={field === f.id}
            onClick={() => {
              setField(f.id);
              setAmount(f.step);
            }}
            className={`h-10 rounded-[9px] text-[13px] font-semibold ${field === f.id ? "bg-surface-3" : "text-muted"}`}
          >
            {t(f.label)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Stepper label={t("By")} value={`${amount > 0 ? "+" : ""}${amount}`} onDown={() => setAmount((a) => +(a - step).toFixed(2))} onUp={() => setAmount((a) => +(a + step).toFixed(2))} />
        <Stepper label={t("Every")} value={every === 1 ? t("wk") : t("{n} wks", { n: every })} onDown={() => setEvery((e) => Math.max(1, e - 1))} onUp={() => setEvery((e) => e + 1)} />
      </div>
      <p className="text-[13px] text-muted">{describeRule({ id: "", order: 0, field, op: "ADD", amount, everyWeeks: every, startWeek: 2, endWeek: null, enabled: true }, row.intensityType)}</p>
      {error && <p className="text-[13px] text-miss">{error}</p>}
      <button
        type="button"
        disabled={pending || amount === 0}
        onClick={() => run(() => addRule(row.id, { field, op: "ADD", amount, everyWeeks: every, startWeek: Math.min(2, block.weeks.length), endWeek: null }))}
        className="h-12 rounded-2xl bg-accent text-[15px] font-semibold text-white disabled:opacity-50"
      >
        {t("Add rule")}
      </button>
    </Sheet>
  );
}

/**
 * Weeks, phases and programs from the phone: add, copy or remove a week of this phase,
 * add the next phase, or start a new program — the desktop's own actions.
 */
export function PlanSheet({ athleteId, block, week, onClose }: { athleteId: string; block: BlockData; week: BlockData["weeks"][number]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(() => ymdOf(calendarToday()));
  const [weeks, setWeeks] = useState(4);
  const base = `/a/coach/${athleteId}/training?view=plan`;

  function run(write: () => Promise<unknown>, then?: (out: unknown) => void) {
    setError(null);
    start(async () => {
      try {
        const out = await write();
        if (then) then(out);
        else router.refresh();
        onClose();
      } catch (e) {
        setError(t(e instanceof Error ? e.message : "Something went wrong."));
      }
    });
  }

  const item = (icon: string, title: string, hint: string, onClick: () => void, danger = false) => (
    <button type="button" disabled={pending} onClick={onClick} className="flex min-h-14 items-center gap-3 rounded-2xl px-2 text-left active:bg-surface-2 disabled:opacity-50">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-[17px] text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-semibold ${danger ? "text-miss" : ""}`}>{title}</span>
        <span className="block text-[12px] text-muted">{hint}</span>
      </span>
    </button>
  );

  return (
    <Sheet title={`${block.program.name} · ${block.phase}`} onClose={onClose}>
      {!making ? (
        <>
          <span className="text-[12px] font-semibold tracking-[0.12em] text-muted">{t("THIS PHASE")}</span>
          {item("+", t("Add a week"), t("A copy of the last regular week; progression rules carry on."), () => run(() => addWeek(block.id)))}
          {item("⧉", t("Copy week {n}", { n: week.order }), t("Added after the last week."), () => run(() => duplicateWeek(week.id)))}
          {block.weeks.length > 1 &&
            item("−", t("Remove week {n}", { n: week.order }), t("Its sessions go; sets already logged stay with the athlete."), () => {
              if (window.confirm(t("Remove week {n}?", { n: week.order }))) run(() => deleteWeek(block.id, week.order));
            }, true)}
          <span className="mt-2 text-[12px] font-semibold tracking-[0.12em] text-muted">{t("PROGRAM")}</span>
          {item("→", t("Add the next phase"), t("Starts the day this program's last phase ends."), () =>
            run(() => addPhase(block.program.id), (id) => router.push(`${base}&block=${id}`)),
          )}
          {item("★", t("New program"), t("Empty, with the days of the week you set in Settings."), () => setMaking(true))}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createProgram({ athleteId, name, startDate, weeks }), (out) => router.push(`${base}&block=${(out as { phaseId: string }).phaseId}`));
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5 text-[12px] text-muted">
            {t("Name")}
            <input value={name} onChange={(e) => setName(e.target.value)} required className="h-11 rounded-xl border border-border bg-background px-3 text-[15px] text-foreground outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-muted">
            {t("Starts")}
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required className="h-11 rounded-xl border border-border bg-background px-3 text-[15px] text-foreground outline-none focus:border-accent" />
          </label>
          <Stepper label={t("Weeks")} value={String(weeks)} onDown={() => setWeeks((w) => Math.max(1, w - 1))} onUp={() => setWeeks((w) => Math.min(16, w + 1))} />
          <button type="submit" disabled={pending || !name.trim()} className="h-12 rounded-2xl bg-accent text-[15px] font-semibold text-white disabled:opacity-50">
            {t("Create program")}
          </button>
        </form>
      )}
      {error && <p className="text-[13px] text-miss">{error}</p>}
    </Sheet>
  );
}
