"use client";

import type { ProgramStatus } from "@/lib/dates";
import { t } from "@/lib/i18n";

const LOOK: Record<ProgramStatus, { cls: string; label: string }> = {
  active: { cls: "bg-ok/15 text-ok-text", label: "active" },
  paused: { cls: "bg-warn/15 text-warn", label: "paused" },
  upcoming: { cls: "bg-surface-3 text-muted", label: "upcoming" },
  done: { cls: "text-muted-2", label: "done" },
};

/**
 * Where a program is: active, paused, upcoming or done. Where programs overlap, one click
 * switches which is trained — a paused one takes over, the trained one steps aside.
 */
export function ProgramStatusBadge({
  status,
  trained,
  onSwitch,
}: {
  status: ProgramStatus;
  /** Whether it is the one trained where it overlaps another. */
  trained?: boolean | null;
  onSwitch?: () => void;
}) {
  const look = LOOK[status];
  const cls = `shrink-0 rounded-full px-1.5 py-px text-[10px] ${look.cls}`;
  if (!onSwitch) return <span className={cls}>{t(look.label)}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSwitch();
      }}
      title={
        trained
          ? t("Trained while programs overlap. Click to pause it and train the other.")
          : t("Paused while programs overlap. Click to train this one instead.")
      }
      className={`${cls} inline-flex items-center gap-1 ring-1 ring-transparent transition hover:ring-current`}
    >
      {t(look.label)}
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
      </svg>
    </button>
  );
}
