"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Unit } from "@prisma/client";
import { deleteBodyweight, logBodyweight, saveCheckinAnswer } from "@/app/a/actions";
import { CheckinIcon } from "@/components/CheckinIcon";
import type { DayCheckin } from "@/lib/athlete-queries";
import { colorOf, formatAnswer, picked, readinessOf, type CheckinQuestionData } from "@/lib/checkins";
import { shortDate, weekdayShort } from "@/lib/athlete-format";
import type { BodyweightEntry } from "@/lib/bodyweight";
import { t } from "@/lib/i18n";

/**
 * The day's check-in: bodyweight first, then the questions the coach asks on the day, each
 * answered the way it was written — a number, a scale, options, yes or no, or a few words.
 * Each answer saves on its own; once every one is in, the card folds to a line of answers
 * that opens again. Weigh-ins still go to the bodyweight log, so the trend and the meet
 * projection read them as before.
 */
export function CheckinCard(props: Parameters<typeof CheckinForm>[0]) {
  if (props.day > props.today) return <UpcomingCheckin day={props.day} questions={props.initial.questions} />;
  return <CheckinForm {...props} />;
}

function CheckinForm({
  token,
  unit,
  day,
  today,
  initial,
  bodyweight,
}: {
  token: string;
  unit: Unit;
  /** The day the questions are for. */
  day: string;
  today: string;
  initial: DayCheckin;
  /** Weigh-ins, newest first. */
  bodyweight: BodyweightEntry[];
}) {
  const { questions } = initial;
  const u = unit === "LB" ? "lb" : "kg";
  // A day still to come can't be weighed yet: that weigh-in goes on today.
  const weighDay = day <= today ? day : today;
  const [weights, setWeights] = useState(bodyweight);
  const [values, setValues] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(initial.answers.map((a) => [a.questionId, a.value])),
  );
  const onDay = weights.find((e) => e.day === weighDay) ?? null;
  const answered = questions.filter((q) => (values[q.id] ?? null) !== null).length + (onDay ? 1 : 0);
  const total = questions.length + 1;
  const complete = answered === total;
  const [open, setOpen] = useState(!complete);
  const [error, setError] = useState<string | null>(null);
  // One save at a time, in tap order: two quick taps must not race to create the answer.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function enqueue(action: () => Promise<unknown>) {
    setError(null);
    queue.current = queue.current
      .then(action)
      .catch((e) => setError(e instanceof Error ? e.message : t("That didn't save. Try again.")));
  }

  function save(q: CheckinQuestionData, value: string | null, raw: unknown = value) {
    const next = { ...values, [q.id]: value };
    setValues(next);
    enqueue(() => saveCheckinAnswer(token, q.id, day, raw));
    // The last answer folds the card away; typing fields fold only once left.
    if (!complete && onDay && questions.every((x) => (next[x.id] ?? null) !== null) && q.kind !== "TEXT" && q.kind !== "NUMBER") {
      setOpen(false);
    }
  }

  /** The day's weigh-in, replaced: the athlete's own entry for the day goes, the new one comes in. */
  function weigh(weight: number | null) {
    const mine = weights.find((e) => e.day === weighDay && e.source === "athlete") ?? null;
    enqueue(async () => {
      if (mine) await deleteBodyweight(token, mine.id);
      const entry = weight === null ? null : await logBodyweight(token, weighDay, weight);
      setWeights((was) => [...(entry ? [entry] : []), ...was.filter((e) => e.id !== mine?.id)]);
    });
  }

  const answers = questions.map((q) => ({ id: q.id, questionId: q.id, day, value: values[q.id] ?? null }));
  const { score } = readinessOf(questions, answers);
  const yesNo = { yes: t("Yes"), no: t("No") };
  const last = weights[0] ?? null;

  return (
    <section className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-[0.14em] text-muted-2">
            {t("CHECK-IN")} <span className="tabular-nums">{answered}/{total}</span>
          </div>
          <div className="truncate text-[13px] text-muted">
            {complete && onDay
              ? [
                  `${t("Bodyweight")} ${onDay.weight} ${u}`,
                  ...questions.map((q) => `${q.label} ${formatAnswer(q, values[q.id] ?? null, yesNo)}`),
                ].join(" · ")
              : questions.length > 0
                ? t("A few questions from your coach")
                : t("Log your bodyweight")}
          </div>
        </div>
        {score !== null && (
          <span className="shrink-0 text-[20px] font-semibold tabular-nums">
            {score}
            <span className="text-[12px] font-normal text-muted">/5</span>
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <div>
            <div className="flex items-center gap-2 text-[14px]">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-3 text-foreground">
                <CheckinIcon name="weight" size={15} />
              </span>
              <span className="min-w-0 flex-1 font-medium">{t("Bodyweight")}</span>
              {!onDay && last && (
                <span className="shrink-0 text-[11px] text-muted-2">
                  {t("Last {w} {u} · {date}", { w: last.weight, u, date: shortDate(last.day) })}
                </span>
              )}
            </div>
            <div className="mt-2">
              <NumberAnswer
                key={onDay?.id ?? "none"}
                value={onDay ? String(onDay.weight) : null}
                unit={u}
                placeholder={last ? String(last.weight) : undefined}
                onSave={(v) => {
                  const n = v === null ? null : Number(v);
                  if (n !== null && (n <= 0 || n > 1000)) return setError(t("That weight doesn't look right."));
                  weigh(n);
                }}
              />
            </div>
          </div>
          {questions.map((q) => (
            <Question key={q.id} q={q} value={values[q.id] ?? null} onSave={(value, raw) => save(q, value, raw)} />
          ))}
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-accent">{error}</div>}
    </section>
  );
}

function Question({
  q,
  value,
  onSave,
}: {
  q: CheckinQuestionData;
  value: string | null;
  onSave: (value: string | null, raw?: unknown) => void;
}) {
  const color = colorOf(q.color);
  return (
    <div>
      <div className="flex items-center gap-2 text-[14px]">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg text-white" style={{ background: color }}>
          <CheckinIcon name={q.icon} size={15} />
        </span>
        <span className="min-w-0 flex-1 font-medium">{q.label}</span>
        {q.cadence === "WEEKLY" && <span className="shrink-0 text-[11px] text-muted-2">{t("this week")}</span>}
      </div>
      <div className="mt-2">
        <Answer q={q} value={value} onSave={onSave} />
      </div>
    </div>
  );
}

const choice = (on: boolean) =>
  `min-h-11 rounded-xl px-3 text-[14px] ${on ? "bg-accent font-medium text-white" : "border border-border bg-background text-muted active:bg-surface-3"}`;

function Answer({
  q,
  value,
  onSave,
}: {
  q: CheckinQuestionData;
  value: string | null;
  onSave: (value: string | null, raw?: unknown) => void;
}) {
  switch (q.kind) {
    case "SCALE":
      return <ScaleAnswer q={q} value={value} onSave={onSave} />;
    case "SINGLE":
      return (
        <div className="flex flex-wrap gap-1.5">
          {(q.config.options ?? []).map((o) => (
            <button key={o} type="button" aria-pressed={value === o} onClick={() => onSave(value === o ? null : o)} className={choice(value === o)}>
              {o}
            </button>
          ))}
        </div>
      );
    case "MULTI": {
      const list = picked(value);
      return (
        <div className="flex flex-wrap gap-1.5">
          {(q.config.options ?? []).map((o) => {
            const on = list.includes(o);
            const next = on ? list.filter((x) => x !== o) : [...list, o];
            const ordered = (q.config.options ?? []).filter((x) => next.includes(x));
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => onSave(ordered.length ? JSON.stringify(ordered) : null, ordered)}
                className={choice(on)}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case "YESNO":
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {(["yes", "no"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={value === v} onClick={() => onSave(value === v ? null : v)} className={choice(value === v)}>
              {v === "yes" ? t("Yes") : t("No")}
            </button>
          ))}
        </div>
      );
    case "NUMBER":
      return <NumberAnswer value={value} unit={q.config.unit} onSave={onSave} />;
    default:
      return <TextAnswer value={value} onSave={onSave} />;
  }
}

function NumberAnswer({
  value,
  unit,
  placeholder = "—",
  onSave,
}: {
  value: string | null;
  unit?: string;
  placeholder?: string;
  onSave: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const n = Number(draft.replace(",", ".").trim());
    const next = draft.trim() === "" || !Number.isFinite(n) ? null : String(Math.round(n * 100) / 100);
    setDraft(null);
    if (next !== value) onSave(next);
  }
  return (
    <label className="flex h-12 items-center rounded-xl border border-border bg-background px-3 focus-within:border-accent">
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        value={draft ?? value ?? ""}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-transparent text-[17px] tabular-nums outline-none placeholder:text-muted-2"
      />
      {unit && <span className="ml-1 text-[14px] text-muted">{unit}</span>}
    </label>
  );
}

function TextAnswer({ value, onSave }: { value: string | null; onSave: (value: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <textarea
      rows={2}
      value={draft ?? value ?? ""}
      placeholder={t("Your answer (optional)")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft?.trim() || null;
        if (draft !== null && next !== value) onSave(next);
        setDraft(null);
      }}
      className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted-2 focus:border-accent"
    />
  );
}

/**
 * A scale as a bar to drag along: it snaps to whole steps and saves once let go. Tapping
 * anywhere on the bar picks that step too; the arrow keys step it. Until answered it shows
 * no thumb, and an answered one can be cleared.
 */
function ScaleAnswer({
  q,
  value,
  onSave,
}: {
  q: CheckinQuestionData;
  value: string | null;
  onSave: (value: string | null) => void;
}) {
  const { min = 1, max = 5, low, high } = q.config;
  const saved = value === null ? null : Number(value);
  const [drag, setDrag] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const shown = drag ?? saved;
  const share = shown === null ? 0 : (shown - min) / (max - min);
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  function stepAt(clientX: number): number {
    const r = bar.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(min + x * (max - min));
  }

  function commit(n: number | null) {
    setDrag(null);
    if (n !== saved) onSave(n === null ? null : String(n));
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(stepAt(e.clientX));
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[22px] font-semibold tabular-nums">
          {shown === null ? <span className="text-[14px] font-normal text-muted-2">{t("Drag to answer")}</span> : shown}
          {shown !== null && <span className="text-[12px] font-normal text-muted">/{max}</span>}
        </span>
        {saved !== null && drag === null && (
          <button type="button" onClick={() => commit(null)} className="text-[12px] text-muted-2">
            {t("Clear")}
          </button>
        )}
      </div>
      <div
        ref={bar}
        role="slider"
        tabIndex={0}
        aria-label={q.label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown ?? undefined}
        onPointerDown={down}
        onPointerMove={(e) => drag !== null && setDrag(stepAt(e.clientX))}
        onPointerUp={() => drag !== null && commit(drag)}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") commit(Math.min(max, (saved ?? min - 1) + 1));
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") commit(Math.max(min, (saved ?? min + 1) - 1));
        }}
        className="relative flex h-11 touch-none select-none items-center outline-none"
      >
        <div className="absolute inset-x-0 h-3 rounded-full bg-surface-3" />
        {shown !== null && (
          <div className="absolute left-0 h-3 rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
        )}
        {/* A tick per step, so the snap points are visible. */}
        {steps.map((n) => (
          <span
            key={n}
            className={`absolute size-1.5 -translate-x-1/2 rounded-full ${shown !== null && n <= shown ? "bg-white/60" : "bg-muted-2/50"}`}
            style={{ left: `${((n - min) / (max - min)) * 100}%` }}
          />
        ))}
        {shown !== null && (
          <span
            className={`absolute size-7 -translate-x-1/2 rounded-full border-4 border-accent bg-white shadow ${drag !== null ? "scale-110" : ""}`}
            style={{ left: `${share * 100}%` }}
          />
        )}
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-muted-2">
        <span>
          {min} {low}
        </span>
        <span>
          {max} {high}
        </span>
      </div>
    </div>
  );
}

/**
 * A day still to come: what its check-in will ask, without anything to fill in yet —
 * answers and the weigh-in go in on the day itself.
 */
function UpcomingCheckin({ day, questions }: { day: string; questions: CheckinQuestionData[] }) {
  return (
    <section className="mt-3 rounded-2xl border border-dashed border-border px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("CHECK-IN")}</div>
        <div className="text-[11px] text-muted-2">{t("Opens on {day}", { day: weekdayShort(day) })}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[{ id: "bw", label: t("Bodyweight"), icon: "weight", color: null as string | null }, ...questions].map((q) => (
          <span key={q.id} className="flex items-center gap-1.5 rounded-lg bg-surface py-1 pl-1 pr-2 text-[12px] text-muted">
            <span
              className={`grid size-5 place-items-center rounded-md ${q.color ? "text-white" : "bg-surface-3 text-foreground"}`}
              style={q.color ? { background: colorOf(q.color) } : undefined}
            >
              <CheckinIcon name={q.icon} size={12} />
            </span>
            {q.label}
          </span>
        ))}
      </div>
    </section>
  );
}
