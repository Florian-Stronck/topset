"use client";

import { LockIcon, ProgrammingGrid } from "@/components/ProgrammingGrid";
import type { MeetSummary } from "@/lib/competition";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import type { AthleteData, BlockData } from "@/lib/types";
import { t } from "@/lib/i18n";

/**
 * The whole program behind one tab strip: every phase's weeks laid out together, so a
 * week two phases away is one click rather than a phase switch and then a week switch.
 */
export type ProgramPosition = { phaseId: string; week: number };

export function WholeProgramSheet({
  phases,
  athlete,
  exerciseHistory,
  meets,
  open,
  onOpen: setOpen,
}: {
  phases: BlockData[];
  athlete: AthleteData;
  exerciseHistory: string[];
  meets: MeetSummary[];
  /** Which week is open — the workspace owns it, so the week keys can walk the whole program. */
  open: ProgramPosition;
  onOpen: (open: ProgramPosition) => void;
}) {

  const phase = phases.find((p) => p.id === open.phaseId) ?? phases[0];
  if (!phase) return null;
  const week = Math.min(open.week, phase.weeks.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        style={{ maxWidth: SHELL_MAX_WIDTH }}
        className="mx-auto flex w-full flex-wrap items-center gap-x-4 border-b border-border bg-background px-4"
      >
        {phases.map((p) => (
          <div key={p.id} className="flex items-center gap-1">
            <span className="pr-1 text-[11px] text-muted-2">{p.phase}</span>
            {p.weeks.map(({ order: w, locked }) => {
              const active = p.id === phase.id && w === week;
              return (
                <div
                  key={w}
                  className={`-mb-px flex items-center border-b-2 ${
                    active ? "border-accent" : "border-transparent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setOpen({ phaseId: p.id, week: w })}
                    className={`py-2 pl-3 text-[12px] ${
                      active ? "font-medium text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {t("Week {n}", { n: w })}
                  </button>
                  {locked && (
                    <span title={t("Week {n} is locked", { n: w })} className="pl-1 text-accent">
                      <LockIcon locked size={11} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <ProgrammingGrid
        key={`${phase.id}-${week}`}
        block={phase}
        athlete={athlete}
        exerciseHistory={exerciseHistory}
        meets={meets}
        week={week}
        onWeek={(w) => setOpen({ phaseId: phase.id, week: w })}
        weekLabel="static"
      />
    </div>
  );
}
