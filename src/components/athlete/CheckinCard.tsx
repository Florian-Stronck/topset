"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Unit } from "@prisma/client";
import { deleteBodyweight, deletePhoto, finishPhoto, logBodyweight, saveCheckinAnswer, startPhoto } from "@/app/a/actions";
import { CheckinIcon } from "@/components/CheckinIcon";
import type { DayCheckin } from "@/lib/athlete-queries";
import {
  colorOf,
  formatAnswer,
  isBodyweight,
  MAX_PHOTOS_PER_ANSWER,
  nutrientOf,
  PHOTO_EDGE,
  picked,
  readinessOf,
  type CheckinQuestionData,
  type PhotoView,
} from "@/lib/checkins";
import { shortDate, weekdayShort } from "@/lib/athlete-format";
import type { BodyweightEntry } from "@/lib/bodyweight";
import { KCAL_TOLERANCE } from "@/lib/nutrition";
import { t } from "@/lib/i18n";

/**
 * The day's check-in: the questions the coach asks on the day, each answered the way it was
 * written — a number, a scale, options, yes or no, or a few words. Each answer saves on its
 * own; once every one is in, the card folds to a line of answers that opens again. The
 * bodyweight question is one of them, but its answer goes to the bodyweight log, so the
 * trend and the weight cut read it. A question the coach asked a photo on takes pictures too.
 */
export function CheckinCard(props: Parameters<typeof CheckinForm>[0]) {
  // A coach who asks nothing gets no card.
  if (props.initial.questions.length === 0) return null;
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
  const [photos, setPhotos] = useState(initial.photos);
  const onDay = weights.find((e) => e.day === weighDay) ?? null;
  const has = (q: CheckinQuestionData, v: Record<string, string | null> = values) =>
    isBodyweight(q) ? onDay !== null : (v[q.id] ?? null) !== null || photos.some((p) => p.questionId === q.id);
  const answered = questions.filter((q) => has(q)).length;
  const total = questions.length;
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
    if (!complete && questions.every((x) => has(x, next)) && q.kind !== "TEXT" && q.kind !== "NUMBER") {
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
            {complete
              ? questions
                  .map((q) => (isBodyweight(q) ? `${q.label} ${onDay?.weight} ${u}` : `${q.label} ${formatAnswer(q, values[q.id] ?? null, yesNo)}`))
                  .join(" · ")
              : t("A few questions from your coach")}
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
          {questions.map((q) =>
            isBodyweight(q) ? (
              <div key={q.id}>
                <QuestionHead q={q}>
                  {!onDay && last && (
                    <span className="shrink-0 text-[11px] text-muted-2">
                      {t("Last {w} {u} · {date}", { w: last.weight, u, date: shortDate(last.day) })}
                    </span>
                  )}
                </QuestionHead>
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
            ) : (
              <Question
                key={q.id}
                q={q}
                value={values[q.id] ?? null}
                onSave={(value, raw) => save(q, value, raw)}
                target={nutrientOf(q) ? (initial.target?.[nutrientOf(q)!] ?? null) : null}
              >
                {q.config.photo && initial.photosOn && (
                  <Photos
                    token={token}
                    q={q}
                    day={day}
                    photos={photos.filter((p) => p.questionId === q.id)}
                    onAdd={(p) => setPhotos((was) => [...was, p])}
                    onRemove={(id) => {
                      setPhotos((was) => was.filter((p) => p.id !== id));
                      enqueue(() => deletePhoto(token, id));
                    }}
                    onError={setError}
                  />
                )}
              </Question>
            ),
          )}
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
  target = null,
  children,
}: {
  q: CheckinQuestionData;
  value: string | null;
  onSave: (value: string | null, raw?: unknown) => void;
  /** A nutrition question's target for the day, from the phase. */
  target?: number | null;
  /** Anything under the answer: its photos. */
  children?: React.ReactNode;
}) {
  const n = nutrientOf(q);
  // Calories count within 10% either way, protein at least the target; carbs and fat are a guide.
  const hit =
    target === null || value === null || (n !== "kcal" && n !== "protein")
      ? null
      : n === "kcal"
        ? Math.abs(Number(value) - target) <= target * KCAL_TOLERANCE
        : Number(value) >= target;
  return (
    <div>
      <QuestionHead q={q}>
        {q.cadence === "WEEKLY" && <span className="shrink-0 text-[11px] text-muted-2">{t("this week")}</span>}
        {target !== null && (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-2">
            {hit !== null && <span className={`size-1.5 rounded-full ${hit ? "bg-ok" : "bg-warn"}`} />}
            {t("target {n} {u}", { n: target, u: q.config.unit ?? "" })}
          </span>
        )}
      </QuestionHead>
      <div className="mt-2">
        <Answer q={q} value={value} onSave={onSave} />
      </div>
      {children}
    </div>
  );
}

/** A photo from the camera or the library, shrunk to a JPEG no wider or taller than PHOTO_EDGE. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t("That photo couldn't be read.")))), "image/jpeg", 0.85),
  );
}

/** The photos on one answer, and a button to take or pick another. */
function Photos({
  token,
  q,
  day,
  photos,
  onAdd,
  onRemove,
  onError,
}: {
  token: string;
  q: CheckinQuestionData;
  day: string;
  photos: PhotoView[];
  onAdd: (photo: PhotoView) => void;
  onRemove: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function add(file: File) {
    setBusy(true);
    try {
      const blob = await shrinkPhoto(file);
      const start = await startPhoto(token, q.id, day, blob.size);
      if (!start.ok) throw new Error(start.error);
      const res = await fetch(start.value.url, { method: "PUT", headers: { "Content-Type": start.value.contentType }, body: blob });
      if (!res.ok) throw new Error(t("The photo didn't upload. Try again."));
      const done = await finishPhoto(token, start.value.id);
      if (!done.ok) throw new Error(done.error);
      onAdd(done.value);
    } catch (e) {
      onError(e instanceof Error ? t(e.message) : t("The photo didn't upload. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {photos.map((p) => (
        <div key={p.id} className="relative">
          <a href={p.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage link, not a static asset */}
            <img src={p.url} alt={q.label} className="size-20 rounded-xl border border-border object-cover" />
          </a>
          <button
            type="button"
            aria-label={t("Delete this photo")}
            onClick={() => onRemove(p.id)}
            className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-border bg-surface text-[13px] text-muted"
          >
            ×
          </button>
        </div>
      ))}
      {photos.length < MAX_PHOTOS_PER_ANSWER && (
        <label
          className={`grid size-20 cursor-pointer place-items-center rounded-xl border border-dashed border-border text-muted active:bg-surface-3 ${busy ? "opacity-50" : ""}`}
        >
          <span className="flex flex-col items-center gap-1 text-[11px]">
            <CheckinIcon name="camera" size={20} />
            {busy ? t("Sending…") : t("Add photo")}
          </span>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void add(file);
            }}
          />
        </label>
      )}
    </div>
  );
}

/** A question's icon and wording, with anything to add on the right. */
function QuestionHead({ q, children }: { q: CheckinQuestionData; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[14px]">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg text-white" style={{ background: colorOf(q.color) }}>
        <CheckinIcon name={q.icon} size={15} />
      </span>
      <span className="min-w-0 flex-1 font-medium">{q.label}</span>
      {children}
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
        {questions.map((q) => (
          <span key={q.id} className="flex items-center gap-1.5 rounded-lg bg-surface py-1 pl-1 pr-2 text-[12px] text-muted">
            <span className="grid size-5 place-items-center rounded-md text-white" style={{ background: colorOf(q.color) }}>
              <CheckinIcon name={q.icon} size={12} />
            </span>
            {q.label}
          </span>
        ))}
      </div>
    </section>
  );
}
