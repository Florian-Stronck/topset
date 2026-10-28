"use client";

import { useRef, useState } from "react";
import type { IntensityType } from "@prisma/client";
import { NumberInput } from "@/components/cells";
import { MenuOptions } from "@/components/Select";
import { Popover } from "@/components/Popover";
import { t } from "@/lib/i18n";

export type IntensityValue = {
  intensityType: IntensityType;
  intensity: number | null;
  intensityMax: number | null;
  rampStep: number | null;
  /** A weight typed over the calculated one, in the WEIGHT column. */
  load?: number | null;
};

/** The kinds of intensity: the chip's short name, and the menu's. */
const KINDS: { value: IntensityType; chip: string; label: string }[] = [
  { value: "PERCENT", chip: "%", label: "%" },
  { value: "RPE", chip: "RPE", label: "RPE" },
  { value: "RIR", chip: "RIR", label: "RIR" },
  { value: "RANGE", chip: "RPE–", label: "Range" },
  { value: "WEIGHT", chip: "Fix", label: "Fixed" },
  { value: "BACKOFF", chip: "−%", label: "Backoff" },
];

/** The kind a cell's text names — its chip, its menu name or its own name, as typed or pasted. */
export function parseKind(text: string): IntensityType | null {
  const want = text.trim().toLowerCase();
  if (want === "") return null;
  const hit = KINDS.find((k) =>
    [k.value, k.chip, k.label, t(k.chip), t(k.label)].some((name) => name.toLowerCase() === want),
  );
  return hit?.value ?? null;
}

/**
 * The intensity's kind, a cell of its own: a chip that opens the kinds, the ramp and the
 * weight's recalculation. How much is the next cell, so either fills down without the other.
 */
export function IntensityKind({
  value,
  onCommit,
}: {
  value: IntensityValue;
  onCommit: (v: Partial<IntensityValue>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const kind = KINDS.find((k) => k.value === value.intensityType) ?? KINDS[0];

  return (
    <div className="flex h-full w-full min-w-0 items-center justify-center px-1">
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("Kind of intensity, range and ramp")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-[22px] shrink-0 items-center gap-0.5 rounded px-1.5 text-[10px] font-medium ${
          open ? "bg-accent-soft text-accent ring-1 ring-accent" : "bg-surface-3 text-muted hover:text-foreground"
        }`}
      >
        {t(kind.chip)}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={196}>
        <div>
          <MenuOptions
            autoFocus={false}
            value={value.intensityType}
            options={KINDS.map((k) => ({ value: k.value, label: t(k.label) }))}
            onPick={(intensityType) => onCommit({ intensityType })}
            className="rounded-md border border-border bg-surface-2 p-1"
          />
          {value.load != null && (
            <button
              type="button"
              onClick={() => onCommit({ load: null })}
              className="mt-1 w-full rounded px-2 py-1 text-left text-[12px] text-accent hover:bg-surface-3"
            >
              {t("Recalculate the weight")}
            </button>
          )}
          {value.intensityType === "BACKOFF" && (
            <p className="mt-1.5 text-[11px] leading-snug text-muted">
              {t("Percent drop from the last exercise above with a real weight.")}
            </p>
          )}

          <div className="mt-2.5 border-t border-border pt-2">
            <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("RAMP UP")}</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[11px] text-muted-2">+</span>
              <div className="w-[60px] rounded border border-border bg-surface">
                <NumberInput
                  value={value.rampStep}
                  align="center"
                  placeholder={t("off")}
                  onCommit={(v) => onCommit({ rampStep: v })}
                />
              </div>
              <span className="text-[11px] text-muted-2">{t("per set")}</span>
              {value.rampStep !== null && (
                <button
                  type="button"
                  onClick={() => onCommit({ rampStep: null })}
                  className="ml-auto text-[11px] text-muted-2 hover:text-accent"
                >
                  {t("clear")}
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted">
              {t("Last set hits the target weight; each earlier set is lighter by this much.")}
            </p>
          </div>
        </div>
      </Popover>
    </div>
  );
}

/** How much: the number, typed straight into the cell, a range's top beside it, and the ramp. */
export function IntensityAmount({
  value,
  onCommit,
}: {
  value: IntensityValue;
  onCommit: (v: Partial<IntensityValue>) => void;
}) {
  const range = value.intensityType === "RANGE";
  // The whole cell lights up as selected, not each box in it, the way a one-field cell does.
  const quiet = "focus:!bg-transparent focus:!ring-0";
  return (
    <div className="flex h-full w-full min-w-0 items-center rounded-[3px] focus-within:bg-surface-3 focus-within:ring-1 focus-within:ring-accent/60">
      <div className="h-full min-w-0 flex-1">
        <NumberInput value={value.intensity} align="center" placeholder="—" className={quiet} onCommit={(v) => onCommit({ intensity: v })} />
      </div>
      {range && (
        <>
          <span className="text-[11px] text-muted-2">–</span>
          <div className="h-full min-w-0 flex-1">
            <NumberInput value={value.intensityMax} align="center" placeholder="—" className={quiet} onCommit={(v) => onCommit({ intensityMax: v })} />
          </div>
        </>
      )}
      {value.rampStep !== null && <span className="pr-1.5 text-[11px] text-muted-2">+{value.rampStep}</span>}
    </div>
  );
}
