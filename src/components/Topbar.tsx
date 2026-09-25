"use client";

import { useRouter } from "next/navigation";
import { Fragment, useRef, useState, useTransition } from "react";
import { copyProgram } from "@/app/athletes/actions";
import { addPhase, closePhaseGap, createProgram, deleteBlock, pastePhase, unpastePhase } from "@/app/programming/actions";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { useHistory } from "@/components/history";
import { setPref, usePref } from "@/lib/prefs";
import { formKeys } from "@/components/cells";
import { Confirm } from "@/components/Confirm";
import { Popover } from "@/components/Popover";
import { ProgramSettings } from "@/components/ProgramSettings";
import { describeGap, formatDate, phaseGaps, snapStart, weekdayOf } from "@/lib/dates";
import { activeSettings, phaseName, type ExportKind } from "@/lib/settings";
import { useSettings } from "@/components/SettingsProvider";
import { WEEKDAYS } from "@/lib/types";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import type { PhaseSummary, ProgramSummary } from "@/lib/queries";
import type { AthleteData } from "@/lib/types";
import { t } from "@/lib/i18n";

/** Panels the palette can open from a keystroke as well as a click. */
/** "delete-phase" asks about the open phase, the same question its chip's × asks. */
export type Panel = "new" | "copy" | "settings" | "delete-phase" | null;

const field =
  "w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";

function phaseHref(athleteId: string, phaseId: string) {
  return `/programming?athlete=${athleteId}&phase=${phaseId}`;
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
  const [addingPhase, setAddingPhase] = useState(false);
  const [deletingPhaseId, setDeletingPhaseId] = useState<string | null>(null);
  const gaps = phaseGaps(program.phases);
  const phaseMenu = useContextMenu();
  const history = useHistory();
  const copied = usePref("clipboard");
  const copiedPhase = copied?.kind === "phase" ? copied : null;

  const openPhase = (id: string) => {
    onView("phase");
    router.push(phaseHref(athlete.id, id));
  };

  /** Pastes a copy of `sourceId` after `afterId` (the end when undefined) and opens it. */
  async function paste(sourceId: string, afterId: string | undefined, label: string) {
    let id = await pastePhase(sourceId, program.id, afterId);
    openPhase(id);
    const back = afterId ?? phase.id;
    history.push({
      label,
      undo: async () => {
        await unpastePhase(id);
        openPhase(back);
      },
      redo: async () => {
        id = await pastePhase(sourceId, program.id, afterId);
        openPhase(id);
      },
    });
  }

  function menuFor(e: React.MouseEvent, p: PhaseSummary) {
    const current = p.id === phase.id && view === "phase";
    const items: MenuItem[] = [
      { label: t("Open phase {name}", { name: p.phase }), onSelect: () => openPhase(p.id), disabled: current },
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
        onSelect: () => void closePhaseGap(p.id),
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-[22px] font-semibold tracking-tight">{t("Programming")}</h1>

          <div data-tour="exports">
            <ExportMenu phaseId={phase.id} week={week} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Where you are: the program, then the phase in it — each a menu of the others. */}
          <div className="flex items-center rounded-full border border-border bg-surface text-[12px]">
            <div data-tour="program" className="flex items-center py-1.5 pl-3 pr-1">
              <select
                value={program.id}
                onChange={(e) => {
                  const next = programs.find((p) => p.id === e.target.value);
                  const first = next?.phases[0];
                  router.push(
                    first
                      ? phaseHref(athlete.id, first.id)
                      : `/programming?athlete=${athlete.id}&program=${e.target.value}`,
                  );
                }}
                className="max-w-[180px] cursor-pointer truncate bg-transparent text-muted outline-none"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
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

          <Popover open={phasesOpen} onClose={() => setPhasesOpen(false)} anchorRef={phaseButtonRef} width={300}>
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
                  const id = await addPhase(program.id);
                  setAddingPhase(false);
                  setPhasesOpen(false);
                  openPhase(id);
                }}
                title={t("Adds the next phase, starting where this program currently ends")}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-2 hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {addingPhase ? t("adding…") : `+ ${t("phase")}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhasesOpen(false);
                  onView(view === "program" ? "phase" : "program");
                }}
                title={t("Every phase of this program end to end")}
                className={`ml-auto rounded-full border px-2.5 py-1 text-[11px] ${
                  view === "program"
                    ? "border-accent/50 bg-surface-2 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {t("Whole program")}
              </button>
            </div>
          </Popover>

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
                    await deleteBlock(p.id);
                    stopDeleting();
                    if (p.id === phase.id) {
                      const next = remaining[0];
                      onView("phase");
                      router.push(next ? phaseHref(athlete.id, next.id) : `/programming?athlete=${athlete.id}`);
                    } else {
                      router.refresh();
                    }
                  }}
                />
              </Popover>
            );
          })()}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <NewProgramButton
              athleteId={athlete.id}
              open={panel === "new"}
              onOpenChange={(open) => onPanel(open ? "new" : null)}
            />

            <CopyProgramButton
              program={program}
              athlete={athlete}
              roster={roster}
              open={panel === "copy"}
              onOpenChange={(open) => onPanel(open ? "copy" : null)}
            />

            <button
              ref={settingsRef}
              data-tour="settings"
              type="button"
              onClick={() => onPanel(panel === "settings" ? null : "settings")}
              title={t("Program and phase names, dates, the 1RMs this phase uses, and the files")}
              className={`rounded-full border px-3 py-1.5 text-[12px] ${
                panel === "settings"
                  ? "border-accent/50 text-accent"
                  : "border-border text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {t("Settings")}
            </button>

            <button
              type="button"
              onClick={() => onView(view === "program" ? "phase" : "program")}
              title={t("Every phase of this program end to end")}
              className={`rounded-full border px-3 py-1.5 text-[12px] ${
                view === "program"
                  ? "border-accent/50 bg-surface-2 text-foreground"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {t("Whole program")}
            </button>
          </div>

          <Popover
            open={panel === "settings"}
            onClose={() => onPanel(null)}
            anchorRef={settingsRef}
            width={344}
          >
            <ProgramSettings
              program={program}
              phase={phase}
              athlete={athlete}
              onClose={() => onPanel(null)}
            />
          </Popover>
        </div>
      </div>
      {phaseMenu.menu}
    </header>
  );
}

export function NewProgramButton({
  athleteId,
  open: controlledOpen,
  onOpenChange,
}: {
  athleteId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [pending, setPending] = useState(false);
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
    router.push(phaseHref(athleteId, phaseId));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
      >
        + {t("New program")}
      </button>

      {open && (
        <div
          onKeyDown={formKeys(submit, () => setOpen(false), pending)}
          className="absolute top-full left-0 z-40 mt-2 w-[268px] rounded-lg border border-border bg-surface-2 p-3 shadow-xl shadow-black/50"
        >
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
      )}
    </div>
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
}: {
  program: ProgramSummary;
  athlete: AthleteData;
  roster: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        title={t("Copy this program, to this athlete or another one")}
        className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
      >
        {t("Copy program")}
      </button>

      {open && (
        <div
          onKeyDown={formKeys(submit, () => onOpenChange(false), pending)}
          className="absolute top-full left-0 z-40 mt-2 w-[290px] rounded-lg border border-border bg-surface-2 p-3 shadow-xl shadow-black/50"
        >
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
      )}
    </div>
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
                await closePhaseGap(phaseId);
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
function ExportMenu({ phaseId, week }: { phaseId: string; week: number }) {
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
