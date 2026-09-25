"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  addCheckinQuestion,
  removeCheckinQuestion,
  reorderCheckinQuestions,
  updateCheckinQuestion,
  type CheckinQuestionInput,
} from "@/app/athletes/actions";
import { CheckinIcon, ICON_NAMES } from "@/components/CheckinIcon";
import { COLORS, colorOf, parseConfig, PRESETS, type CheckinKind, type CheckinQuestionData } from "@/lib/checkins";
import { t, weekdayShort } from "@/lib/i18n";

const BLANK: CheckinQuestionInput = { label: "", cadence: "DAILY", days: [], kind: "SCALE", config: { min: 1, max: 5 }, icon: "check", color: "blue" };

/** When a question is asked, in a few words: "Daily", "Mon · Thu", "Weekly · Sun". */
function whenAsked(q: Pick<CheckinQuestionData, "cadence" | "days">): string {
  if (q.cadence === "WEEKLY") return `${t("Weekly")} · ${weekdayShort(q.days[0] ?? 0)}`;
  if (q.days.length === 0 || q.days.length === 7) return t("Daily");
  return q.days.map((d) => weekdayShort(d)).join(" · ");
}

/**
 * An athlete's check-in on their roster card: the questions the athlete app asks, as chips
 * to open and edit or drag into order, and a button to add one.
 */
export function CheckinQuestions({ athleteId, questions }: { athleteId: string; questions: CheckinQuestionData[] }) {
  const [editing, setEditing] = useState<CheckinQuestionData | "new" | null>(null);
  const [order, setOrder] = useState(questions);
  const [synced, setSynced] = useState(questions);
  const [dragging, setDragging] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  if (synced !== questions) {
    setSynced(questions);
    setOrder(questions);
  }

  function drop(onto: string) {
    if (!dragging || dragging === onto) return;
    const ids = order.map((q) => q.id).filter((id) => id !== dragging);
    ids.splice(ids.indexOf(onto), 0, dragging);
    setOrder(ids.map((id) => order.find((q) => q.id === id)!));
    setDragging(null);
    startTransition(() => reorderCheckinQuestions(athleteId, ids));
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] tracking-[0.14em] text-muted-2" title={t("What the athlete app asks before training, after their bodyweight.")}>
          {t("CHECK-IN")}
        </span>
        {order.length === 0 && <span className="text-[11px] text-muted-2">{t("bodyweight only")}</span>}
        <Link href={`/tracking?athlete=${athleteId}&view=wellness#checkins`} className="ml-auto text-[11px] text-muted hover:text-accent">
          {t("See answers")} →
        </Link>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {order.map((q) => (
          <button
            key={q.id}
            type="button"
            draggable
            onDragStart={() => setDragging(q.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(q.id)}
            onClick={() => setEditing(q)}
            title={t("Click to edit, drag to reorder")}
            className={`flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 py-1 pl-1 pr-2 text-[12px] hover:border-muted-2 ${
              dragging === q.id ? "opacity-50" : ""
            }`}
          >
            <span className="grid size-5 place-items-center rounded-md text-white" style={{ background: colorOf(q.color) }}>
              <CheckinIcon name={q.icon} size={12} />
            </span>
            <span className="max-w-[160px] truncate">{q.label}</span>
            <span className="text-[10px] text-muted-2">{whenAsked(q)}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded-lg border border-dashed border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
        >
          + {t("Add question")}
        </button>
      </div>

      {editing && (
        <QuestionEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await addCheckinQuestion(athleteId, input);
            else await updateCheckinQuestion(editing.id, input);
            setEditing(null);
          }}
          onRemove={
            editing === "new"
              ? null
              : async () => {
                  await removeCheckinQuestion(editing.id);
                  setEditing(null);
                }
          }
        />
      )}
    </div>
  );
}

const KIND_TILES: { kind: CheckinKind; label: string; icon: React.ReactNode }[] = [
  { kind: "NUMBER", label: "Number", icon: <span className="text-[17px] font-semibold leading-none">#</span> },
  { kind: "SCALE", label: "Scale", icon: <CheckinIcon name="gauge" size={18} /> },
  {
    kind: "SINGLE",
    label: "Single choice",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4" fill="currentColor" />
      </svg>
    ),
  },
  {
    kind: "MULTI",
    label: "Multiple choice",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="m8 12 3 3 5-6" />
      </svg>
    ),
  },
  {
    kind: "YESNO",
    label: "Yes / No",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="2" y="6" width="20" height="12" rx="6" />
        <circle cx="16" cy="12" r="3" fill="currentColor" />
      </svg>
    ),
  },
  {
    kind: "TEXT",
    label: "Text",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
];

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 text-[11px] tracking-[0.14em] text-muted-2">{label}</div>
      {children}
    </div>
  );
}

/** Writing or rewriting one question: presets to start from, then every part of it. */
function QuestionEditor({
  initial,
  onClose,
  onSave,
  onRemove,
}: {
  initial: CheckinQuestionData | null;
  onClose: () => void;
  onSave: (input: CheckinQuestionInput) => Promise<void>;
  onRemove: (() => Promise<void>) | null;
}) {
  const [q, setQ] = useState<CheckinQuestionInput>(() =>
    initial
      ? { label: initial.label, cadence: initial.cadence, days: initial.days, kind: initial.kind, config: initial.config, icon: initial.icon, color: initial.color }
      : BLANK,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<CheckinQuestionInput>) => setQ((was) => ({ ...was, ...p }));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t("That didn't save. Try again."));
      setPending(false);
    }
  }

  function setKind(kind: CheckinKind) {
    // Keep what carries over (the options between single and multiple choice).
    patch({ kind, config: parseConfig(kind, kind === "SCALE" ? { min: 1, max: 5, ...q.config } : q.config) });
  }

  function toggleDay(d: number) {
    if (q.cadence === "WEEKLY") return patch({ days: [d] });
    patch({ days: q.days.includes(d) ? q.days.filter((x) => x !== d) : [...q.days, d].sort() });
  }

  const color = colorOf(q.color);
  const ready = q.label.trim() !== "" && ((q.kind !== "SINGLE" && q.kind !== "MULTI") || (q.config.options ?? []).length >= 2);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className="max-h-[92vh] w-full max-w-[560px] overflow-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <h2 className="text-[16px] font-semibold">{initial ? t("Edit question") : t("New question")}</h2>

        {!initial && (
          <Section label={t("START FROM A PRESET")}>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() =>
                    setQ((was) => ({
                      ...was,
                      label: t(p.label),
                      kind: p.kind,
                      config: {
                        ...p.config,
                        ...(p.config.low ? { low: t(p.config.low) } : {}),
                        ...(p.config.high ? { high: t(p.config.high) } : {}),
                        ...(p.config.options ? { options: p.config.options.map((o) => t(o)) } : {}),
                      },
                      icon: p.icon,
                      color: p.color,
                    }))
                  }
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-muted-2 hover:text-foreground"
                >
                  <CheckinIcon name={p.icon} size={14} />
                  {t(p.label)}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section label={t("QUESTION")}>
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: color }}>
              <CheckinIcon name={q.icon} size={20} />
            </span>
            <input
              autoFocus
              value={q.label}
              onChange={(e) => patch({ label: e.target.value })}
              placeholder={t("How did you sleep?")}
              maxLength={120}
              className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[14px] outline-none placeholder:text-muted-2 focus:border-accent"
            />
          </div>
        </Section>

        <Section label={t("ASKED")}>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-background p-1">
            {(["DAILY", "WEEKLY"] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={q.cadence === c}
                onClick={() => patch({ cadence: c, days: c === "WEEKLY" ? [q.days[0] ?? 0] : [] })}
                className={`h-9 rounded-lg text-[13px] ${q.cadence === c ? "bg-surface-3 font-medium text-foreground" : "text-muted"}`}
              >
                {c === "DAILY" ? t("Daily") : t("Weekly")}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const on = q.cadence === "WEEKLY" ? (q.days[0] ?? 0) === d : q.days.length === 0 || q.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => (q.cadence === "DAILY" && q.days.length === 0 ? patch({ days: [0, 1, 2, 3, 4, 5, 6].filter((x) => x !== d) }) : toggleDay(d))}
                  className={`h-7 w-9 rounded-md text-[11px] ${on ? "bg-accent-soft font-medium text-accent" : "border border-border text-muted-2 hover:text-foreground"}`}
                >
                  {weekdayShort(d).slice(0, 2)}
                </button>
              );
            })}
            <span className="ml-2 text-[11px] text-muted-2">
              {q.cadence === "WEEKLY" ? t("Opens on this day, stays open to the end of the week") : q.days.length === 0 ? t("Every day") : ""}
            </span>
          </div>
        </Section>

        <Section label={t("ANSWER")}>
          <div className="grid grid-cols-3 gap-1.5">
            {KIND_TILES.map((k) => (
              <button
                key={k.kind}
                type="button"
                aria-pressed={q.kind === k.kind}
                onClick={() => setKind(k.kind)}
                className={`flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border text-[12px] ${
                  q.kind === k.kind ? "border-accent bg-accent-soft text-foreground" : "border-border bg-background text-muted hover:text-foreground"
                }`}
              >
                {k.icon}
                {t(k.label)}
              </button>
            ))}
          </div>
          <KindSettings q={q} onConfig={(config) => patch({ config })} />
        </Section>

        <Section label={t("ICON")}>
          <div className="flex flex-wrap gap-1.5">
            {ICON_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={q.icon === name}
                aria-label={name}
                onClick={() => patch({ icon: name })}
                className={`grid size-9 place-items-center rounded-lg border ${
                  q.icon === name ? "border-accent bg-accent-soft text-foreground" : "border-border bg-background text-muted hover:text-foreground"
                }`}
              >
                <CheckinIcon name={name} size={16} />
              </button>
            ))}
          </div>
        </Section>

        <Section label={t("COLOR")}>
          <div className="flex flex-wrap gap-2.5">
            {Object.entries(COLORS).map(([name, hex]) => (
              <button
                key={name}
                type="button"
                aria-pressed={q.color === name}
                aria-label={name}
                onClick={() => patch({ color: name })}
                className={`size-8 rounded-full ${q.color === name ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`}
                style={{ background: hex }}
              />
            ))}
          </div>
        </Section>

        {error && <div className="mt-4 text-[12px] text-accent">{error}</div>}

        <div className="mt-6 flex items-center gap-2">
          {onRemove && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(onRemove)}
              className="rounded-lg px-3 py-2 text-[13px] text-muted hover:text-miss"
            >
              {t("Remove")}
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-4 py-2 text-[13px] text-muted hover:text-foreground">
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={!ready || pending}
            onClick={() => run(() => onSave(q))}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {initial ? t("Save") : t("Add question")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What the answer kind needs: a unit, the ends of a scale, or the options. */
function KindSettings({ q, onConfig }: { q: CheckinQuestionInput; onConfig: (config: CheckinQuestionInput["config"]) => void }) {
  const [option, setOption] = useState("");
  const field = "h-9 min-w-0 rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-2 focus:border-accent";

  if (q.kind === "NUMBER") {
    return (
      <label className="mt-3 flex items-center gap-2 text-[12px] text-muted">
        {t("Unit")}
        <input value={q.config.unit ?? ""} maxLength={12} onChange={(e) => onConfig({ unit: e.target.value })} placeholder="kcal, h, L…" className={`${field} w-32`} />
      </label>
    );
  }
  if (q.kind === "SCALE") {
    const { min = 1, max = 5 } = q.config;
    const pick = (value: number, set: (n: number) => void, from: number, to: number) => (
      <select value={value} onChange={(e) => set(Number(e.target.value))} className={`${field} w-16`}>
        {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    );
    return (
      <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-2 text-[12px] text-muted">
        {pick(min, (n) => onConfig({ ...q.config, min: n }), 0, 1)}
        <input value={q.config.low ?? ""} maxLength={40} onChange={(e) => onConfig({ ...q.config, low: e.target.value })} placeholder={t("Worst, e.g. Poor")} className={field} />
        {pick(max, (n) => onConfig({ ...q.config, max: n }), 3, 10)}
        <input value={q.config.high ?? ""} maxLength={40} onChange={(e) => onConfig({ ...q.config, high: e.target.value })} placeholder={t("Best, e.g. Great")} className={field} />
        <span className="col-span-2 text-[11px] text-muted-2">{t("Put the good end high: scales feed the readiness score, higher is better.")}</span>
      </div>
    );
  }
  if (q.kind === "SINGLE" || q.kind === "MULTI") {
    const options = q.config.options ?? [];
    const add = () => {
      const o = option.trim();
      if (o && !options.includes(o)) onConfig({ options: [...options, o] });
      setOption("");
    };
    return (
      <div className="mt-3">
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <span key={o} className="flex items-center gap-1 rounded-full border border-border bg-background py-1 pl-3 pr-1.5 text-[12px]">
              {o}
              <button type="button" aria-label={t("Remove")} onClick={() => onConfig({ options: options.filter((x) => x !== o) })} className="grid size-5 place-items-center rounded-full text-muted-2 hover:text-miss">
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={option}
            maxLength={40}
            onChange={(e) => setOption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={t("Add an option")}
            className={`${field} flex-1`}
          />
          <button type="button" onClick={add} className="rounded-lg border border-border px-3 text-[12px] text-muted hover:text-foreground">
            {t("Add")}
          </button>
        </div>
        {options.length < 2 && <div className="mt-1 text-[11px] text-muted-2">{t("At least two options.")}</div>}
      </div>
    );
  }
  return null;
}
