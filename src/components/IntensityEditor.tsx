"use client";

import { useRef, useState } from "react";
import type { IntensityType } from "@prisma/client";
import { NumberInput } from "@/components/cells";
import { Popover } from "@/components/Popover";
import { t } from "@/lib/i18n";

export type IntensityValue = {
  intensityType: IntensityType;
  intensity: number | null;
  intensityMax: number | null;
  rampStep: number | null;
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

/**
 * The intensity cell in two: what kind (a chip that opens the kinds, the range's top and
 * the ramp) and how much, typed straight into the cell. What it comes to — the weight —
 * sits to the right.
 */
export function IntensityEditor({
  value,
  resolved,
  onCommit,
}: {
  value: IntensityValue;
  /** The weight it works out to, or null to leave it out. */
  resolved: string | null;
  onCommit: (v: Partial<IntensityValue>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const kind = KINDS.find((k) => k.value === value.intensityType) ?? KINDS[0];
  const range = value.intensityType === "RANGE";

  return (
    <div className="flex h-full w-full min-w-0 items-center gap-1 pl-1 pr-2">
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

      <div className={`shrink-0 ${range ? "w-[32px]" : "w-[40px]"}`}>
        <NumberInput value={value.intensity} align="center" placeholder="—" onCommit={(v) => onCommit({ intensity: v })} />
      </div>
      {range && (
        <>
          <span className="text-[11px] text-muted-2">–</span>
          <div className="w-[32px] shrink-0">
            <NumberInput value={value.intensityMax} align="center" placeholder="—" onCommit={(v) => onCommit({ intensityMax: v })} />
          </div>
        </>
      )}

      {resolved !== null && (
        <span className="ml-auto min-w-0 truncate text-right text-[12px] tabular-nums">
          {resolved}
          {value.rampStep !== null && <span className="ml-1 text-[11px] text-muted-2">+{value.rampStep}</span>}
        </span>
      )}

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={196}>
        <div>
          <div role="menu" className="rounded-md border border-border bg-surface-2 p-1">
            {KINDS.map((k) => {
              const on = k.value === value.intensityType;
              return (
                <button
                  key={k.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => onCommit({ intensityType: k.value })}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[12px] ${
                    on ? "bg-surface-3 text-foreground" : "text-muted hover:bg-surface-3 hover:text-foreground"
                  }`}
                >
                  {t(k.label)}
                  {on && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
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
