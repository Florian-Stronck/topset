"use client";

import { useRouter } from "next/navigation";
import { Fragment, useRef, useState, useTransition } from "react";
import { copyProgram } from "@/app/athletes/actions";
import {
  addPhase,
  closePhaseGap,
  createProgram,
  deleteBlock,
  deleteProgram,
  pastePhase,
  restoreBlock,
  setPhaseStarts,
  unpastePhase,
} from "@/app/programming/actions";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { useHistory, type History } from "@/components/history";
import { setPref, usePref } from "@/lib/prefs";
import { formKeys } from "@/components/cells";
import { Confirm } from "@/components/Confirm";
import { Popover } from "@/components/Popover";
import { PhaseSettings, ProgramSettings } from "@/components/ProgramSettings";
import { GridTools } from "@/components/ProgrammingGrid";
import { describeGap, formatDate, phaseGaps, snapStart, weekdayOf } from "@/lib/dates";
import { activeSettings, phaseName, type ExportKind } from "@/lib/settings";
import { useSettings } from "@/components/SettingsProvider";
import { WEEKDAYS } from "@/lib/types";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import type { PhaseSummary, ProgramSummary } from "@/lib/queries";
import type { AthleteData } from "@/lib/types";
import { t } from "@/lib/i18n";
import { tutorialDid } from "@/components/Tutorial";

/** Panels the palette can open from a keystroke as well as a click. */
/** "delete-phase" asks about the open phase, the same question its chip's × asks. */
export type Panel = "new" | "copy" | "settings" | "phase-settings" | "delete-phase" | null;

const field =
  "w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";

function phaseHref(athleteId: string, phaseId: string) {
  return `/programming?athlete=${athleteId}&phase=${phaseId}`;
}

/*
 * Phase edits as undoable steps — the topbar, the settings and the palette all make them.
 * `open` shows a phase; each step lands back on the phase it is about.
 */

/** Adds a phase at the end of the program and opens it; undo goes back to `back`. */
export async function addPhaseUndoable(history: History, programId: string, open: (id: string) => void, back: string) {
  let id = await addPhase(programId);
  open(id);
  history.push({
    label: "add phase",
    undo: async () => {
      await deleteBlock(id);
      open(back);
    },
    redo: async () => {
      id = await addPhase(programId);
      open(id);
    },
  });
}

/** Deletes a phase, all of it kept for the undo; `after` moves off it once it is gone. */
export async function deletePhaseUndoable(
  history: History,
  phaseId: string,
  open: (id: string) => void,
  after: () => void,
) {
  let snapshot = await deleteBlock(phaseId);
  after();
  if (!snapshot) return;
  history.push({
    label: "delete phase",
    undo: async () => {
      if (snapshot) await restoreBlock(snapshot);
      open(phaseId);
    },
    redo: async () => {
      snapshot = await deleteBlock(phaseId);
      after();
    },
  });
}

/** Closes the break or overlap before a phase; undo puts every moved phase back. */
export async function closeGapUndoable(history: History, phaseId: string) {
  let before = await closePhaseGap(phaseId);
  if (before.length === 0) return;
  history.push({
    label: "close gap",
    undo: () => setPhaseStarts(before),
    redo: async () => {
      before = await closePhaseGap(phaseId);
    },
  });
}

/** Pastes a copy of `sourceId` after `afterId` (the end when undefined) and opens it. */
export async function pastePhaseUndoable(
  history: History,
  programId: string,
  open: (id: string) => void,
  sourceId: string,
  afterId: string | undefined,
  back: string,
  label: string,
) {
  let id = await pastePhase(sourceId, programId, afterId);
  open(id);
  history.push({
    label,
    undo: async () => {
      await unpastePhase(id);
      open(back);
    },
    redo: async () => {
      id = await pastePhase(sourceId, programId, afterId);
      open(id);
    },
  });
}

export function Topbar({
  programs,
  program,
  phase,
  athlete,
  roster,
  panel,
  onPanel,
  view,
  onView,
  week,
}: {
  programs: ProgramSummary[];
  program: ProgramSummary;
  phase: PhaseSummary;
  athlete: AthleteData;
  roster: { id: string; name: string }[];
  panel: Panel;
  onPanel: (panel: Panel) => void;
  view: "phase" | "program";
  onView: (view: "phase" | "program") => void;
  /** The week open in the grid, for "print this week". */
  week: number;
}) {
  const router = useRouter();
  const settingsRef = useRef<HTMLButtonElement>(null);
  const phaseButtonRef = useRef<HTMLButtonElement>(null);
  const [phasesOpen, setPhasesOpen] = useState(false);
  const [programsOpen, setProgramsOpen] = useState(false);
  /** The program whose delete question is up. */
  const [deletingProgramId, setDeletingProgramId] = useState<string | null>(null);
  const programButtonRef = useRef<HTMLButtonElement>(null);
  /** Program panels open under whichever opened them: the program list or the ⋯. */
  const [panelFrom, setPanelFrom] = useState<"menu" | "programs">("menu");
  const panelAnchor = panelFrom === "programs" ? programButtonRef : settingsRef;
  const panelAlign = panelFrom === "programs" ? "left" : "right";
  const [addingPhase, setAddingPhase] = useState(false);
  const [deletingPhaseId, setDeletingPhaseId] = useState<string | null>(null);
  const gaps = phaseGaps(program.phases);
  const phaseMenu = useContextMenu();
  const programMenu = useContextMenu();
  const history = useHistory();
  const copied = usePref("clipboard");
  const copiedPhase = copied?.kind === "phase" ? copied : null;

  const openPhase = (id: string) => {
    onView("phase");
    router.push(phaseHref(athlete.id, id));
  };

  /** Pastes a copy of `sourceId` after `afterId` (the end when undefined) and opens it. */
  function paste(sourceId: string, afterId: string | undefined, label: string) {
    return pastePhaseUndoable(history, program.id, openPhase, sourceId, afterId, afterId ?? phase.id, label);
  }

  /** Opens a program at its first phase. */
  function openProgram(p: ProgramSummary) {
    setProgramsOpen(false);
    if (p.id === program.id) return;
    onView("phase");
    const first = p.phases[0];
    router.push(first ? phaseHref(athlete.id, first.id) : `/programming?athlete=${athlete.id}&program=${p.id}`);
  }

  /** A program's right-click menu, in the list or on the picker. The open one can be edited. */
  function programMenuFor(e: React.MouseEvent, p: ProgramSummary) {
    const current = p.id === program.id;
    const panelAt = (next: Panel) => () => {
      setProgramsOpen(false);
      setPanelFrom("programs");
      onPanel(next);
    };
    programMenu.open(e, [
      { label: t("Open {name}", { name: p.name }), onSelect: () => openProgram(p), disabled: current },
      { label: t("Program settings…"), disabled: !current, onSelect: panelAt("settings") },
      { label: t("Copy program…"), disabled: !current, onSelect: panelAt("copy") },
      { label: t("New program…"), onSelect: panelAt("new") },
      "divider",
      {
        label: t("Delete {name}…", { name: p.name }),
        danger: true,
        onSelect: () => {
          setProgramsOpen(false);
          setDeletingProgramId(p.id);
        },
      },
    ]);
  }

  function menuFor(e: React.MouseEvent, p: PhaseSummary) {
    const current = p.id === phase.id && view === "phase";
    const items: MenuItem[] = [
      { label: t("Open phase {name}", { name: p.phase }), onSelect: () => openPhase(p.id), disabled: current },
      { label: t("Phase settings…"), disabled: !current, onSelect: () => onPanel("phase-settings") },
      {
        label: t("Rename phase"),
        disabled: !current,
        onSelect: () => {
          const input = document.querySelector<HTMLInputElement>('[data-focus="phase-name"] input');
          input?.focus();
          input?.select();
        },
      },
      "divider",
      {
        label: t("Copy phase"),
        onSelect: () => setPref("clipboard", { kind: "phase", id: p.id, label: `${program.name} · ${p.phase}` }),
      },
      {
        label: copiedPhase
          ? t("Paste “{name}” after this phase", { name: copiedPhase.label })
          : t("Paste phase after this one"),
        disabled: !copiedPhase,
        onSelect: () => copiedPhase && void paste(copiedPhase.id, p.id, "paste phase"),
      },
      { label: t("Duplicate phase"), onSelect: () => void paste(p.id, p.id, "duplicate phase") },
    ];
    if (gaps.has(p.id)) {
      items.push("divider", {
        label: t("Close the {gap} before {phase}", { gap: describeGap(gaps.get(p.id)!), phase: p.phase }),
        onSelect: () => void closeGapUndoable(history, p.id),
      });
    }
    items.push("divider", {
      label: t("Delete phase {name}…", { name: p.phase }),
      danger: true,
      disabled: program.phases.length <= 1,
      onSelect: () => setDeletingPhaseId(p.id),
    });
    phaseMenu.open(e, items);
  }
  const deletingId = deletingPhaseId ?? (panel === "delete-phase" ? phase.id : null);

  function stopDeleting() {
    setDeletingPhaseId(null);
    if (panel === "delete-phase") onPanel(null);
  }

  return (
    <header className="border-b border-border bg-background">
      <div style={{ maxWidth: SHELL_MAX_WIDTH }} className="mx-auto w-full px-4 pt-5 pb-3">
        {/* Laid out like Tracking's: the heading, what is open under it, the tools on the right. */}
        <div className="flex flex-wrap items-end gap-x-2 gap-y-3">
        <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{t("Programming")}</h1>
        <div className="mt-1.5 flex items-center gap-2">
          {/* Where you are: the program, then the phase in it — each a menu of the others. */}
          <div className="flex items-center rounded-full border border-border bg-surface text-[12px]">
            <button
              ref={programButtonRef}
              data-tour="program"
              type="button"
              onClick={() => setProgramsOpen((o) => !o)}
              onContextMenu={(e) => programMenuFor(e, program)}
              title={t("The athlete's programs")}
              className="flex max-w-[200px] items-center gap-1.5 py-1.5 pl-3 pr-1 text-muted hover:text-foreground"
            >
              <span className="truncate">{program.name}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <span className="text-muted-2">/</span>
            <button
              ref={phaseButtonRef}
              data-tour="phases"
              type="button"
              onClick={() => setPhasesOpen((o) => !o)}
              onContextMenu={(e) => menuFor(e, phase)}
              title={t("The phases of this program")}
              className="flex max-w-[220px] items-center gap-1.5 py-1.5 pl-2 pr-3 font-medium"
            >
              <span className="truncate">{view === "program" ? t("Whole program") : phase.phase}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
          {(() => {
            const at = program.phases.findIndex((p) => p.id === phase.id);
            const next = view === "phase" ? program.phases[at + 1] : undefined;
            return (
              <button
                type="button"
                disabled={!next}
                onClick={() => next && openPhase(next.id)}
                title={next ? t("Open phase {name}", { name: next.phase }) : undefined}
                className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            );
          })()}

          <Popover open={programsOpen} onClose={() => setProgramsOpen(false)} anchorRef={programButtonRef} width={320}>
            <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("PROGRAMS")}</div>
            <div className="mt-1.5 space-y-0.5">
              {programs.map((p) => {
                const weeks = p.phases.reduce((n, x) => n + x.weeks.length, 0);
                const first = p.phases[0];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openProgram(p)}
                    onContextMenu={(e) => programMenuFor(e, p)}
                    title={first ? t("From {date}", { date: formatDate(first.startDate) }) : undefined}
                    className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${
                      p.id === program.id ? "bg-surface-3" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-2">
                      {t(p.phases.length === 1 ? "{n} phase" : "{n} phases", { n: p.phases.length })} ·{" "}
                      {t(weeks === 1 ? "{n} week" : "{n} weeks", { n: weeks })}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => {
                  setProgramsOpen(false);
                  setPanelFrom("programs");
                  onPanel("new");
                }}
                className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-2 hover:border-accent hover:text-accent"
              >
                + {t("program")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProgramsOpen(false);
                  setPanelFrom("programs");
                  onPanel("copy");
                }}
                className="shrink-0 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
              >
                {t("Copy program")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProgramsOpen(false);
                  setPanelFrom("programs");
                  onPanel("settings");
                }}
                className="ml-auto shrink-0 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
              >
                {t("Program settings")}
              </button>
            </div>
          </Popover>

          <Popover open={phasesOpen} onClose={() => setPhasesOpen(false)} anchorRef={phaseButtonRef} width={340}>
            <div className="text-[11px] tracking-[0.16em] text-muted-2">{t("PHASES")}</div>
            <div className="mt-1.5 space-y-0.5">
              {program.phases.map((p, i) => (
                <Fragment key={p.id}>
                  {gaps.has(p.id) && (
                    <div className="py-0.5">
                      <GapChip
                        days={gaps.get(p.id)!}
                        phaseId={p.id}
                        phase={p.phase}
                        previous={program.phases[i - 1].phase}
                      />
                    </div>
                  )}
                  <div
                    onContextMenu={(e) => menuFor(e, p)}
                    className={`group flex items-center rounded-md pr-1 ${
                      p.id === phase.id && view === "phase" ? "bg-surface-3" : "hover:bg-surface-2"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPhasesOpen(false);
                        openPhase(p.id);
                      }}
                      className="flex min-w-0 flex-1 items-baseline gap-2 px-2 py-1.5 text-left text-[12px]"
                    >
                      <span className="text-muted-2">{i + 1}.</span>
                      <span className="truncate">{p.phase}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-2">
                        {t(p.weeks.length === 1 ? "{n} week from {date}" : "{n} weeks from {date}", {
                          n: p.weeks.length,
                          date: formatDate(p.startDate),
                        })}
                      </span>
                    </button>
                    {program.phases.length > 1 && (
                      <button
                        type="button"
                        title={t("Delete phase “{name}”", { name: p.phase })}
                        onClick={() => {
                          setPhasesOpen(false);
                          setDeletingPhaseId(p.id);
                        }}
                        className="rounded-full p-1 text-muted-2 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                      >
                        <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M2 2l10 10M12 2L2 12" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                </Fragment>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
              <button
                type="button"
                disabled={addingPhase}
                onContextMenu={(e) =>
                  phaseMenu.open(e, [
                    {
                      label: copiedPhase ? t("Paste “{name}” at the end", { name: copiedPhase.label }) : t("Paste phase at the end"),
                      disabled: !copiedPhase,
                      onSelect: () => copiedPhase && void paste(copiedPhase.id, undefined, "paste phase"),
                    },
                  ])
                }
                onClick={async () => {
                  setAddingPhase(true);
                  await addPhaseUndoable(history, program.id, openPhase, phase.id);
                  setAddingPhase(false);
                  setPhasesOpen(false);
                }}
                title={t("Adds the next phase, starting where this program currently ends")}
                className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-2 hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {addingPhase ? t("adding…") : `+ ${t("phase")}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhasesOpen(false);
                  onView("phase");
                  onPanel("phase-settings");
                }}
                title={t("Name, dates, 1RMs and nutrition of this phase")}
                className="shrink-0 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
              >
                {t("Phase settings")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhasesOpen(false);
                  onView(view === "program" ? "phase" : "program");
                }}
                title={t("Every phase of this program end to end")}
                className={`ml-auto shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] ${
                  view === "program"
                    ? "border-accent/50 bg-surface-2 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {t("Whole program")}
              </button>
            </div>
          </Popover>

          {deletingProgramId && (() => {
            const p = programs.find((x) => x.id === deletingProgramId);
            if (!p) return null;
            return (
              <Popover open onClose={() => setDeletingProgramId(null)} anchorRef={programButtonRef} width={260}>
                <Confirm
                  label="Delete the program"
                  question={t(p.phases.length === 1 ? "Delete “{name}” and its phase?" : "Delete “{name}” and all {n} phases?", { name: p.name, n: p.phases.length })}
                  initiallyConfirming
                  onConfirm={async () => {
                    await deleteProgram(p.id);
                    setDeletingProgramId(null);
                    // Off the deleted one: the next program the athlete has, or none.
                    const next = programs.find((x) => x.id !== p.id && x.phases[0]);
                    if (p.id !== program.id) router.refresh();
                    else {
                      onView("phase");
                      router.push(next ? phaseHref(athlete.id, next.phases[0].id) : `/programming?athlete=${athlete.id}`);
                    }
                  }}
                />
              </Popover>
            );
          })()}

          {deletingId && (() => {
            const p = program.phases.find((x) => x.id === deletingId);
            if (!p) return null;
            return (
              <Popover
                open
                onClose={stopDeleting}
                anchorRef={phaseButtonRef}
                width={220}
                align="right"
              >
                <Confirm
                  label="Delete this phase"
                  question={t("Delete the phase “{name}”?", { name: p.phase })}
                  initiallyConfirming
                  onConfirm={async () => {
                    const remaining = program.phases.filter((x) => x.id !== p.id);
                    const current = p.id === phase.id;
                    stopDeleting();
                    await deletePhaseUndoable(history, p.id, openPhase, () => {
                      if (!current) return router.refresh();
                      const next = remaining[0];
                      onView("phase");
                      router.push(next ? phaseHref(athlete.id, next.id) : `/programming?athlete=${athlete.id}`);
                    });
                  }}
                />
              </Popover>
            );
          })()}

        </div>
        </div>
          <div className="ml-auto flex items-center gap-2">
            {/* This phase, or every phase end to end. */}
            <div className="flex h-8 items-center rounded-full border border-border p-0.5 text-[12px]">
              {(["phase", "program"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => onView(v)}
                  title={v === "program" ? t("Every phase of this program end to end") : undefined}
                  className={`h-full rounded-full px-3 ${
                    view === v ? "bg-surface-3 text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  {v === "phase" ? t("Phase") : t("Whole program")}
                </button>
              ))}
            </div>

            <GridTools />

            <div data-tour="exports">
              <ExportMenu phaseId={phase.id} athleteId={athlete.id} week={week} />
            </div>

            {/* New, copy and settings: one menu, their panels open under it. */}
            <button
              ref={settingsRef}
              data-tour="settings"
              type="button"
              aria-label={t("Program menu")}
              title={t("New program, copy program, settings")}
              onClick={(e) => {
                setPanelFrom("menu");
                programMenu.open(e, [
                  { label: t("New program…"), onSelect: () => onPanel("new") },
                  { label: t("Copy program…"), onSelect: () => onPanel("copy") },
                  "divider",
                  { label: t("Program settings…"), onSelect: () => onPanel("settings") },
                  { label: t("Phase settings…"), onSelect: () => onPanel("phase-settings") },
                ]);
              }}
              className={`grid size-8 place-items-center rounded-full border text-[14px] leading-none ${
                panel !== null && panel !== "delete-phase"
                  ? "border-accent/50 text-accent"
                  : "border-border text-muted hover:border-accent hover:text-accent"
              }`}
            >
              ⋯
            </button>
            <NewProgramButton
              athleteId={athlete.id}
              anchorRef={panelAnchor}
              align={panelAlign}
              open={panel === "new"}
              onOpenChange={(open) => onPanel(open ? "new" : null)}
            />
            <CopyProgramButton
              program={program}
              athlete={athlete}
              roster={roster}
              anchorRef={panelAnchor}
              align={panelAlign}
              open={panel === "copy"}
              onOpenChange={(open) => onPanel(open ? "copy" : null)}
            />
          </div>

          <Popover
            open={panel === "settings"}
            onClose={() => onPanel(null)}
            anchorRef={panelAnchor}
            width={344}
            align={panelAlign}
          >
            <ProgramSettings
              program={program}
              phase={phase}
              athlete={athlete}
              onClose={() => onPanel(null)}
            />
          </Popover>

          <Popover
            open={panel === "phase-settings"}
            onClose={() => onPanel(null)}
            anchorRef={phaseButtonRef}
            width={344}
          >
            <PhaseSettings
              program={program}
              phase={phase}
              athlete={athlete}
              onClose={() => onPanel(null)}
            />
          </Popover>
        </div>
      </div>
      {phaseMenu.menu}
      {programMenu.menu}
    </header>
  );
}

export function NewProgramButton({
  athleteId,
  open: controlledOpen,
  onOpenChange,
  anchorRef,
  align = "right",
}: {
  athleteId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Opens under this instead of a button of its own — the topbar's ⋯ menu. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  align?: "left" | "right";
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [pending, setPending] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState({
    name: "",
    phase: "",
    startDate: new Date().toISOString().slice(0, 10),
    weeks: activeSettings().programWeeks,
  });

  async function submit() {
    setPending(true);
    const { phaseId } = await createProgram({ athleteId, ...form });
    setPending(false);
    setOpen(false);
    setForm((f) => ({ ...f, name: "", phase: "" }));
    tutorialDid("program");
    router.push(phaseHref(athleteId, phaseId));
  }

  return (
    <>
      {!anchorRef && (
        <button
          ref={buttonRef}
          data-tour="new-program"
          type="button"
          onClick={() => setOpen(!open)}
          className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
        >
          + {t("New program")}
        </button>
      )}

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef ?? buttonRef} width={268} align={anchorRef ? align : "left"}>
        <div onKeyDown={formKeys(submit, () => setOpen(false), pending)}>
          <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("NEW PROGRAM")}</div>

          <input
            autoFocus
            value={form.name}
            placeholder={t("Program name")}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={`mt-2 ${field}`}
          />
          <input
            value={form.phase}
            placeholder={t("First phase, e.g. {name}", { name: phaseName(0) })}
            onChange={(e) => setForm({ ...form, phase: e.target.value })}
            className={`mt-1.5 ${field}`}
          />
          <div className="mt-1.5 flex gap-1.5">
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className={field}
            />
            <input
              type="number"
              min={1}
              max={52}
              value={form.weeks}
              onChange={(e) => setForm({ ...form, weeks: Number(e.target.value) })}
              className="w-[68px] rounded border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/60"
            />
          </div>
          <MondayHint date={form.startDate} />

          <div className="mt-2.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
            >
              {pending ? t("Creating…") : t("Create")}
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}

/**
 * Copies a program onto any athlete on the roster, the current one included. Every phase
 * comes across and they keep their spacing: the start date moves the first phase, and the
 * rest follow by the same number of days.
 */
function CopyProgramButton({
  program,
  athlete,
  roster,
  open,
  onOpenChange,
  anchorRef,
  align,
}: {
  program: ProgramSummary;
  athlete: AthleteData;
  roster: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  align: "left" | "right";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState(() => defaults(program, athlete.id));

  // Reopening after switching program starts from that program's defaults.
  const [seed, setSeed] = useState(program.id);
  if (seed !== program.id) {
    setSeed(program.id);
    setForm(defaults(program, athlete.id));
  }

  const weeks = program.phases.reduce((n, p) => n + p.weeks.length, 0);

  async function submit() {
    setPending(true);
    const { phaseId } = await copyProgram(program.id, {
      athleteId: form.athleteId,
      name: form.name,
      startDate: form.startDate,
    });
    setPending(false);
    onOpenChange(false);
    router.push(
      phaseId
        ? phaseHref(form.athleteId, phaseId)
        : `/programming?athlete=${form.athleteId}`,
    );
  }

  return (
    <>
      <Popover open={open} onClose={() => onOpenChange(false)} anchorRef={anchorRef} width={290} align={align}>
        <div onKeyDown={formKeys(submit, () => onOpenChange(false), pending)}>
          <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("COPY “{name}”", { name: program.name })}</div>

          <select
            value={form.athleteId}
            onChange={(e) => setForm({ ...form, athleteId: e.target.value })}
            className={`mt-2 cursor-pointer ${field}`}
          >
            {roster.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === athlete.id ? `${a.name} (${t("duplicate here")})` : a.name}
              </option>
            ))}
          </select>

          <input
            autoFocus
            value={form.name}
            placeholder={t("Program name")}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={`mt-1.5 ${field}`}
          />
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className={`mt-1.5 ${field}`}
          />
          <MondayHint date={form.startDate} />

          <div className="mt-2 text-[11px] leading-snug text-muted-2">
            {program.phases.length} phase{program.phases.length === 1 ? "" : "s"}, {weeks} week
            {weeks === 1 ? "" : "s"} of prescription, rules included. Logged weights and athlete
            notes stay behind.
          </div>

          <div className="mt-2.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
            >
              {pending ? t("Copying…") : t("Copy")}
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}

/**
 * A break or overlap between two phases. A break is often on purpose — rest, vacation —
 * so it is only a note until clicked; the fix is one click from there.
 */
function GapChip({
  days,
  phaseId,
  phase,
  previous,
}: {
  days: number;
  phaseId: string;
  phase: string;
  previous: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLButtonElement>(null);
  const history = useHistory();
  const isBreak = days > 0;

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`rounded px-1.5 py-0.5 text-[11px] ${
          isBreak
            ? "border border-dashed border-amber-500/40 text-amber-400/90 hover:bg-amber-500/10"
            : "border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20"
        } ${pending ? "opacity-60" : ""}`}
      >
        {describeGap(days)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={260}>
        <p className="text-[11px] leading-snug text-muted">
          {isBreak
            ? t("{gap} between “{previous}” and “{phase}” — no training then.", { gap: describeGap(days), previous, phase })
            : t("“{phase}” starts before “{previous}” ends — both would run at once.", { previous, phase })}
        </p>
        <div className="mt-2.5 flex flex-col gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await closeGapUndoable(history, phaseId);
                setOpen(false);
              })
            }
            className="rounded bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-60"
          >
            {isBreak ? t("Start “{phase}” right after “{previous}”", { phase, previous }) : t("Start “{phase}” when “{previous}” ends", { phase, previous })}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-border px-2.5 py-1.5 text-[11px] text-muted hover:text-foreground"
          >
            {isBreak ? t("Keep the break (rest / vacation)") : t("Leave it")}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-2">
          {t("Phases after it move by the same amount, keeping their spacing.")}
        </p>
      </Popover>
    </>
  );
}

type ExportItem = { label: string; hint: string; href: string; newTab?: boolean; kind?: ExportKind };

/** Every way out of Topset in one menu, grouped by who the file is for. */
function ExportMenu({ phaseId, athleteId, week }: { phaseId: string; athleteId: string; week: number }) {
  const [open, setOpen] = useState(false);
  const { defaultExport } = useSettings().settings;
  const ref = useRef<HTMLButtonElement>(null);
  const url = (format: string, extra = "") => `/api/export?blockId=${phaseId}&format=${format}${extra}`;

  const groups: { title: string; items: ExportItem[] }[] = [
    {
      title: "SPREADSHEET",
      items: [{ label: "Whole program .xlsx", hint: "One sheet per phase", href: url("xlsx"), kind: "xlsx" }],
    },
    {
      title: "FOR THE ATHLETE",
      items: [
        { label: "Phone .pdf", hint: "One week per page", href: url("pdf"), newTab: true, kind: "pdf" },
        { label: "Print week {week}", hint: "Boxes to log what was done", href: url("print", `&week=${week}`), newTab: true },
        { label: "Print this phase", hint: "Every week on paper", href: url("print"), newTab: true, kind: "print" },
        // The live plan on their phone, next to the paper ones.
        { label: "Athlete app link / QR", hint: "Their check-in link", href: `/athletes?link=${athleteId}` },
      ],
    },
    {
      title: "OTHER TOOLS",
      items: [
        { label: "Repwise .xlsx", hint: "RPECALC layout", href: url("repwise"), kind: "repwise" },
        { label: "Repwise .tsv", hint: "To paste into a Google Sheet", href: url("repwise-tsv"), kind: "repwise-tsv" },
        { label: ".csv", hint: "Plain data", href: url("csv"), kind: "csv" },
      ],
    },
    {
      title: "BACKUP",
      items: [{ label: "Everything (.db)", hint: "All athletes and programs", href: "/api/backup" }],
    },
  ];

  // The coach's usual export sits on top, one click away.
  const favourite = groups.flatMap((g) => g.items).find((item) => item.kind === defaultExport);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white hover:opacity-90"
      >
        {t("Export")}
        <svg viewBox="0 0 12 12" className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 4.5 6 7.5l3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={260} align="right">
        <div className="-mx-1.5 -my-1.5 space-y-2">
          {favourite && (
            <a
              href={favourite.href}
              target={favourite.newTab ? "_blank" : undefined}
              rel={favourite.newTab ? "noreferrer" : undefined}
              onClick={() => setOpen(false)}
              className="flex items-baseline gap-2 rounded bg-accent-soft px-1.5 py-1.5 text-[12px] font-medium text-accent hover:bg-accent/20"
            >
              ★ {t(favourite.label, { week })}
              <span className="ml-auto text-[11px] font-normal opacity-80">{t("your default")}</span>
            </a>
          )}
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-1.5 pb-0.5 text-[11px] tracking-[0.14em] text-muted-2">{t(g.title)}</div>
              {g.items.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target={item.newTab ? "_blank" : undefined}
                  rel={item.newTab ? "noreferrer" : undefined}
                  onClick={() => setOpen(false)}
                  className="flex items-baseline gap-2 rounded px-1.5 py-1 text-[12px] text-foreground hover:bg-surface-3"
                >
                  {t(item.label, { week })}
                  <span className="ml-auto truncate text-[11px] text-muted-2">{t(item.hint)}</span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

function MondayHint({ date }: { date: string }) {
  const start = snapStart(date);
  if (!date || start === date) return null;
  return (
    <div className="mt-1 text-[11px] text-muted-2">
      {t("Starts on that week’s {day} — {date}", { day: t(WEEKDAYS[weekdayOf(start)]), date: formatDate(start) })}
    </div>
  );
}

/** A duplicate lands after the program ends; a copy onto someone else keeps its dates. */
function defaults(program: ProgramSummary, athleteId: string) {
  const first = program.phases[0];
  const weeks = program.phases.reduce((n, p) => n + p.weeks.length, 0);
  const after = first ? new Date(first.startDate) : new Date();
  if (first) after.setDate(after.getDate() + weeks * 7);

  return {
    athleteId,
    name: `${program.name} (copy)`,
    startDate: after.toISOString().slice(0, 10),
  };
}
