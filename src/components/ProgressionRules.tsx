"use client";

import { useRef, useState, useTransition } from "react";
import type { IntensityType, ProgField, ProgOp } from "@prisma/client";
import { addRule, deleteRule, restoreRule, updateRule } from "@/app/programming/actions";
import { useHistory, type History } from "@/components/history";
import { useAutoCommit, useSelectOnFocus } from "@/components/cells";
import { Popover } from "@/components/Popover";
import { describeRule, type Rule } from "@/lib/progression";
import { useSettings } from "@/components/SettingsProvider";
import { t } from "@/lib/i18n";
import { tutorialDid } from "@/components/Tutorial";

const FIELDS: { value: ProgField; label: string }[] = [
  { value: "REPS", label: "Reps" },
  { value: "SETS", label: "Sets" },
  { value: "INTENSITY", label: "Intensity" },
  { value: "LOAD", label: "Weight" },
  { value: "DURATION", label: "Time (seconds)" },
];

/** What an amount on this field counts in, beside its box. */
function unitOf(field: ProgField, op: ProgOp, intensityType: IntensityType): string {
  if (op === "MULTIPLY") return "×";
  if (field === "SETS") return t("sets");
  if (field === "REPS") return t("reps");
  if (field === "DURATION") return "s";
  if (field === "LOAD") return "kg";
  if (intensityType === "PERCENT") return "%";
  if (intensityType === "WEIGHT" || intensityType === "RANGE") return "kg";
  return intensityType === "RIR" ? "RIR" : "RPE";
}

type Sign = "ADD" | "SUB" | "MULTIPLY";

/** − is stored as + with a negative amount; the box shows the size, the menu the sign. */
function signOf(op: ProgOp, amount: number): Sign {
  return op === "MULTIPLY" ? "MULTIPLY" : amount < 0 ? "SUB" : "ADD";
}

function fromSign(sign: Sign, size: number): { op: ProgOp; amount: number } {
  if (sign === "MULTIPLY") return { op: "MULTIPLY", amount: Math.abs(size) };
  return { op: "ADD", amount: sign === "SUB" ? -Math.abs(size) : Math.abs(size) };
}

function SignOptions() {
  return (
    <>
      <option value="ADD">+</option>
      <option value="SUB">−</option>
      <option value="MULTIPLY">×</option>
    </>
  );
}

function stepOf(field: ProgField, op: ProgOp): string {
  if (op === "MULTIPLY") return "0.05";
  return field === "SETS" || field === "REPS" ? "1" : field === "DURATION" ? "5" : "0.5";
}

/** Adds a rule as an undoable edit. */
async function addTracked(history: History, rowId: string, rule: Parameters<typeof addRule>[1]) {
  let id = await addRule(rowId, rule);
  tutorialDid("rule");
  history.push({
    label: "add rule",
    undo: () => deleteRule(id),
    redo: async () => {
      id = await addRule(rowId, rule);
    },
  });
}

export function ProgressionRules({
  rowId,
  rules,
  intensityType,
  weeks,
}: {
  rowId: string;
  rules: Rule[];
  intensityType: IntensityType;
  weeks: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLButtonElement>(null);
  const presets = useSettings().settings.progressionPresets;
  const history = useHistory();

  const active = rules.filter((r) => r.enabled);

  return (
    <div className="w-full">
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-1 overflow-hidden rounded-[3px] px-2 py-1 text-left text-[11px] hover:bg-surface-3 ${
          pending ? "opacity-60" : ""
        }`}
      >
        {active.length === 0 ? (
          <span className="text-muted-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">{t("+ progression")}</span>
        ) : (
          active.map((r) => (
            <span
              key={r.id}
              className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 whitespace-nowrap text-accent"
            >
              {describeRule(r, intensityType)}
            </span>
          ))
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={360}>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] tracking-[0.14em] text-muted-2">{t("PROGRESSION")}</span>
            <span className="text-[11px] text-muted-2">week 1 → week {weeks}</span>
          </div>

          <p className="mt-1.5 text-[11px] leading-snug text-muted">
            {t("Rules stack in order, applied to week 1 to rewrite later weeks.")}
          </p>

          {rules.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {rules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} intensityType={intensityType} weeks={weeks} />
              ))}
            </div>
          )}

          <div className="mt-3 text-[11px] tracking-[0.14em] text-muted-2">{t("ADD")}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {presets.map(({ label, ...rule }) => (
              <button
                key={label}
                type="button"
                onClick={() =>
                  startTransition(() =>
                    addTracked(history, rowId, {
                      ...rule,
                      startWeek: Math.min(rule.startWeek, weeks),
                      endWeek: rule.endWeek === null ? null : Math.min(rule.endWeek, weeks),
                    }),
                  )
                }
                className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
              >
                {label}
              </button>
            ))}
          </div>

          <CustomRule rowId={rowId} weeks={weeks} intensityType={intensityType} />
        </div>
      </Popover>
    </div>
  );
}

function RuleRow({
  rule,
  intensityType,
  weeks,
}: {
  rule: Rule;
  intensityType: IntensityType;
  weeks: number;
}) {
  const [, startTransition] = useTransition();
  const history = useHistory();
  const num = "w-[46px] rounded border border-border bg-surface px-1 py-0.5 text-[11px] outline-none";

  /** One change to the rule, undoable; a number box saving as it is typed folds into one step. */
  function patch<K extends keyof Rule>(field: K, next: Rule[K]) {
    patchMany({ [field]: next } as Partial<Rule>);
  }

  /** One change to the rule, undoable; a number box saving as it is typed folds into one step. */
  function patchMany(next: Partial<Rule>) {
    const keys = Object.keys(next) as (keyof Rule)[];
    if (keys.every((k) => next[k] === rule[k])) return;
    const was = Object.fromEntries(keys.map((k) => [k, rule[k]])) as Partial<Rule>;
    startTransition(() => {
      void updateRule(rule.id, next);
    });
    history.push({
      label: "rule",
      undo: () => updateRule(rule.id, was),
      redo: () => updateRule(rule.id, next),
      key: `rule:${rule.id}:${keys.join(",")}`,
    });
  }

  const control = "rounded border border-border bg-surface-2 px-1 py-0.5 text-[11px] outline-none";

  return (
    <div className={`rounded border border-border bg-surface p-1.5 ${rule.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={rule.enabled}
          title={rule.enabled ? t("Turn off") : t("Turn on")}
          onChange={(e) => patch("enabled", e.target.checked)}
          className="accent-[var(--accent)]"
        />
        <select value={rule.field} onChange={(e) => patch("field", e.target.value as ProgField)} className={control}>
          {FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {t(f.label)}
            </option>
          ))}
        </select>
        <select
          value={signOf(rule.op, rule.amount)}
          onChange={(e) => patchMany(fromSign(e.target.value as Sign, rule.amount))}
          className={control}
        >
          <SignOptions />
        </select>
        <RuleNumber
          key={`${rule.field}:${signOf(rule.op, rule.amount)}`}
          min={0}
          step={stepOf(rule.field, rule.op)}
          value={Math.abs(rule.amount)}
          className={num}
          onCommit={(v) => v !== "" && patch("amount", fromSign(signOf(rule.op, rule.amount), Number(v)).amount)}
        />
        <span className="text-[11px] text-muted-2">{unitOf(rule.field, rule.op, intensityType)}</span>
        <span className={`ml-auto truncate text-[11px] ${rule.enabled ? "text-accent" : "text-muted-2 line-through"}`}>
          {describeRule(rule, intensityType)}
        </span>
        <button
          type="button"
          title={t("Remove rule")}
          onClick={() =>
            startTransition(async () => {
              const gone = await deleteRule(rule.id);
              history.push({ label: "remove rule", undo: () => restoreRule(gone), redo: () => deleteRule(gone.id) });
            })
          }
          className="px-1 text-[12px] text-muted-2 hover:text-accent"
        >
          ×
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-1 pl-5 text-[11px] text-muted-2">
        <span>{t("every")}</span>
        <RuleNumber
          min={1}
          value={rule.everyWeeks}
          className={num}
          onCommit={(v) => patch("everyWeeks", Math.max(1, Number(v)))}
        />
        <span>{t("wk")}</span>
        <span className="mx-1 text-border">·</span>
        <span>{t("weeks")}</span>
        <RuleNumber
          min={2}
          max={weeks}
          value={rule.startWeek}
          className={num}
          onCommit={(v) => patch("startWeek", Math.max(2, Number(v)))}
        />
        <span>→</span>
        <RuleNumber
          min={2}
          max={weeks}
          placeholder={t("end")}
          value={rule.endWeek ?? ""}
          className={num}
          onCommit={(v) => patch("endWeek", v === "" ? null : Number(v))}
        />
      </div>
    </div>
  );
}

function CustomRule({ rowId, weeks, intensityType }: { rowId: string; weeks: number; intensityType: IntensityType }) {
  const [, startTransition] = useTransition();
  const history = useHistory();
  const [draft, setDraft] = useState<{ field: ProgField; sign: Sign; amount: number }>({
    field: "REPS",
    sign: "ADD",
    amount: 1,
  });

  const control = "rounded border border-border bg-surface px-1.5 py-1 text-[11px] outline-none";

  return (
    <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
      <select
        value={draft.field}
        onChange={(e) => setDraft({ ...draft, field: e.target.value as ProgField })}
        className={control}
      >
        {FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {t(f.label)}
          </option>
        ))}
      </select>
      <select
        value={draft.sign}
        onChange={(e) => setDraft({ ...draft, sign: e.target.value as Sign })}
        className={control}
      >
        <SignOptions />
      </select>
      <input
        type="number"
        min={0}
        step={stepOf(draft.field, draft.sign === "MULTIPLY" ? "MULTIPLY" : "ADD")}
        value={draft.amount}
        onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
        className={`${control} w-[56px]`}
      />
      <span className="text-[11px] text-muted-2">{unitOf(draft.field, draft.sign === "MULTIPLY" ? "MULTIPLY" : "ADD", intensityType)}</span>
      <button
        type="button"
        onClick={() =>
          startTransition(() =>
            addTracked(history, rowId, {
              field: draft.field,
              ...fromSign(draft.sign, draft.amount),
              everyWeeks: 1,
              startWeek: Math.min(2, weeks),
              endWeek: null,
            }),
          )
        }
        className="ml-auto rounded bg-accent px-2 py-1 text-[11px] font-medium text-white"
      >
        {t("Add rule")}
      </button>
    </div>
  );
}

/**
 * A rule's number box. It saves itself shortly after typing stops as well as on the way
 * out: clicking outside closes this popover, and a blur that never fires would otherwise
 * take the edit with it.
 */
function RuleNumber({
  value,
  onCommit,
  className,
  min,
  max,
  step,
  placeholder,
}: {
  value: number | string;
  onCommit: (value: string) => void;
  className: string;
  min?: number;
  max?: number;
  step?: string;
  placeholder?: string;
}) {
  const auto = useAutoCommit();
  const select = useSelectOnFocus();

  return (
    <input
      {...select}
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      defaultValue={value}
      onChange={(e) => {
        const typed = e.target.value;
        auto.schedule(() => onCommit(typed));
      }}
      onBlur={(e) => {
        auto.cancel();
        onCommit(e.target.value);
      }}
      className={className}
    />
  );
}
