"use client";

import { useRef, useState, useTransition } from "react";
import type { IntensityType, ProgField, ProgOp } from "@prisma/client";
import { addRule, deleteRule, updateRule } from "@/app/programming/actions";
import { useAutoCommit, useSelectOnFocus } from "@/components/cells";
import { Popover } from "@/components/Popover";
import { describeRule, type Rule } from "@/lib/progression";
import { useSettings } from "@/components/SettingsProvider";
import { t } from "@/lib/i18n";

const FIELDS: { value: ProgField; label: string }[] = [
  { value: "REPS", label: "Reps" },
  { value: "SETS", label: "Sets" },
  { value: "INTENSITY", label: "Intensity" },
];

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
          <span className="text-muted-2">{t("+ progression")}</span>
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

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={320}>
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
                  startTransition(() => {
                    void addRule(rowId, {
                      ...rule,
                      startWeek: Math.min(rule.startWeek, weeks),
                      endWeek: rule.endWeek === null ? null : Math.min(rule.endWeek, weeks),
                    });
                  })
                }
                className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
              >
                {label}
              </button>
            ))}
          </div>

          <CustomRule rowId={rowId} weeks={weeks} />
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
  const num = "w-[46px] rounded border border-border bg-surface px-1 py-0.5 text-[11px] outline-none";

  return (
    <div className="rounded border border-border bg-surface p-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) =>
            startTransition(() => {
              void updateRule(rule.id, { enabled: e.target.checked });
            })
          }
          className="accent-[var(--accent)]"
        />
        <span className={`flex-1 text-[11px] ${rule.enabled ? "" : "text-muted-2 line-through"}`}>
          {describeRule(rule, intensityType)}
        </span>
        <button
          type="button"
          title={t("Remove rule")}
          onClick={() =>
            startTransition(() => {
              void deleteRule(rule.id);
            })
          }
          className="px-1 text-[12px] text-accent"
        >
          ×
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-2">
        <span>{t("by")}</span>
        <RuleNumber
          step="0.5"
          value={rule.amount}
          className={num}
          onCommit={(v) =>
            startTransition(() => {
              void updateRule(rule.id, { amount: Number(v) });
            })
          }
        />
        <span>{t("every")}</span>
        <RuleNumber
          min={1}
          value={rule.everyWeeks}
          className={num}
          onCommit={(v) =>
            startTransition(() => {
              void updateRule(rule.id, { everyWeeks: Math.max(1, Number(v)) });
            })
          }
        />
        <span>{t("wk, from")}</span>
        <RuleNumber
          min={2}
          max={weeks}
          value={rule.startWeek}
          className={num}
          onCommit={(v) =>
            startTransition(() => {
              void updateRule(rule.id, { startWeek: Math.max(2, Number(v)) });
            })
          }
        />
        <span>{t("to")}</span>
        <RuleNumber
          min={2}
          max={weeks}
          placeholder={t("end")}
          value={rule.endWeek ?? ""}
          className={num}
          onCommit={(v) =>
            startTransition(() => {
              void updateRule(rule.id, { endWeek: v === "" ? null : Number(v) });
            })
          }
        />
      </div>
    </div>
  );
}

function CustomRule({ rowId, weeks }: { rowId: string; weeks: number }) {
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<{ field: ProgField; op: ProgOp; amount: number }>({
    field: "REPS",
    op: "ADD",
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
        value={draft.op}
        onChange={(e) => setDraft({ ...draft, op: e.target.value as ProgOp })}
        className={control}
      >
        <option value="ADD">+</option>
        <option value="MULTIPLY">×</option>
      </select>
      <input
        type="number"
        step="0.5"
        value={draft.amount}
        onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
        className={`${control} w-[64px]`}
      />
      <button
        type="button"
        onClick={() =>
          startTransition(() => {
            void addRule(rowId, {
              ...draft,
              everyWeeks: 1,
              startWeek: Math.min(2, weeks),
              endWeek: null,
            });
          })
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
