"use client";

import Link from "next/link";
import { injuryLabel, type InjuryData } from "@/lib/injuries";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createExampleAthlete } from "@/app/athletes/actions";
import { syncEverything } from "@/app/settings/cloud-actions";
import {
  applyAllProgressions,
  deleteWeek,
  importProgram,
  pasteWeek,
  setWeekLock,
  updateDay,
} from "@/app/programming/actions";
import { useHistory } from "@/components/history";
import { addWeekUndoable, ProgrammingGrid } from "@/components/ProgrammingGrid";
import { addPhaseUndoable, closeGapUndoable, pastePhaseUndoable, Topbar, type Panel } from "@/components/Topbar";
import { WholeProgramSheet, type ProgramPosition } from "@/components/WholeProgramSheet";
import type { MeetSummary } from "@/lib/competition";
import { describeGap, phaseGaps } from "@/lib/dates";
import { pickFile, restoreBackup } from "@/lib/pick-file";
import { fresh, useCommands, type Command } from "@/lib/commands";
import { setPref, togglePref, usePref, type Column } from "@/lib/prefs";
import type { ProgramSummary } from "@/lib/queries";
import type { AthleteData, BlockData } from "@/lib/types";
import { t } from "@/lib/i18n";

/** The export routes are downloads, not pages: the router would try to navigate to them. */
/** The grid's switchable columns as the palette names them: header, then search words. */
const COLUMN_COMMANDS: [Column, string, string][] = [
  ["progression", "PROGRESSION", "rules"],
  ["time", "TIME", "duration rounds seconds minutes interval timed"],
  ["weight", "WEIGHT", "load kg lb calculated override"],
  ["tempo", "TEMPO", ""],
  ["rest", "REST", "timer pause between sets"],
  ["video", "VIDEO", "link url"],
  ["notes", "COACH NOTES", "comments"],
];

function download(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Puts the caret in one of the grid header's fields, once the phase view has rendered. */
function focusField(name: string) {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-focus="${name}"] input`);
    input?.focus();
    input?.select();
  });
}

/**
 * Owns the program's commands — the active week, the phases, the topbar's panels — and
 * hands them to the command center, which runs them from the palette or their keys. The
 * grid registers the row-scoped ones, since those only mean anything with a focused cell.
 */
export function ProgrammingWorkspace({
  phase: block,
  initialWeek,
  program,
  programs,
  wholeProgram,
  athlete,
  roster,
  exerciseHistory,
  meets,
  injuries,
}: {
  phase: BlockData;
  /** The week in the URL, so a reload opens where the coach was. */
  initialWeek: number;
  program: ProgramSummary;
  programs: ProgramSummary[];
  wholeProgram: BlockData[];
  athlete: AthleteData;
  roster: { id: string; name: string }[];
  exerciseHistory: string[];
  meets: MeetSummary[];
  /** Injuries the athlete has now, worst first — kept in sight while the plan is written. */
  injuries: InjuryData[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const history = useHistory();

  const [week, setWeek] = useState(initialWeek);
  const [view, setView] = useState<"phase" | "program">("phase");
  const [panel, setPanel] = useState<Panel>(null);
  const [deletingWeek, setDeletingWeek] = useState<number | null>(null);
  const [programPos, setProgramPos] = useState<ProgramPosition | null>(null);

  // A different phase starts back at week 1.
  const [syncedId, setSyncedId] = useState(block.id);
  if (syncedId !== block.id) {
    setSyncedId(block.id);
    setWeek(1);
    setDeletingWeek(null);
  }

  const phase = program.phases.find((p) => p.id === block.id) ?? program.phases[0];

  const activeWeek = Math.min(week, block.weeks.length);

  // The phase and week open go in the URL — written in place, not navigated to, so a
  // week switch stays instant — and a reload comes back to them.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("phase") === block.id && url.searchParams.get("week") === String(activeWeek)) return;
    url.searchParams.set("phase", block.id);
    url.searchParams.set("week", String(activeWeek));
    window.history.replaceState(null, "", url);
  }, [block.id, activeWeek]);
  const tightIntensity = usePref("tightIntensity");
  const columns = usePref("columns");
  const hideRest = usePref("hideRestDays");
  const copied = usePref("clipboard");

  // The whole-program view opens where the phase view is, until a week is picked in it.
  const programOpen = useMemo<ProgramPosition>(
    () =>
      programPos && wholeProgram.some((p) => p.id === programPos.phaseId)
        ? programPos
        : { phaseId: block.id, week: activeWeek },
    [programPos, wholeProgram, block.id, activeWeek],
  );

  const commands = useMemo<Command[]>(() => {
    const weekData = block.weeks[activeWeek - 1];
    const phaseIndex = program.phases.findIndex((p) => p.id === block.id);
    const openPhase = (id: string) => {
      setView("phase");
      router.push(`/programming?athlete=${athlete.id}&phase=${id}`);
    };
    /** Every week of every phase in order, for stepping across phase boundaries. */
    const programWeeks = wholeProgram.flatMap((p) =>
      p.weeks.map((w) => ({ phaseId: p.id, week: w.order })),
    );
    const stepWeek = (by: 1 | -1) => {
      if (view === "phase") {
        setWeek((w) => Math.min(block.weeks.length, Math.max(1, w + by)));
        return;
      }
      const at = programWeeks.findIndex(
        (w) => w.phaseId === programOpen.phaseId && w.week === programOpen.week,
      );
      const next = programWeeks[Math.min(programWeeks.length - 1, Math.max(0, at + by))];
      if (next) setProgramPos(next);
    };
    /** Pastes a week after the open one and opens it; undo takes it out again. */
    const pasteWeekUndoable = async (sourceId: string, label: string) => {
      let order = await pasteWeek(sourceId, block.id, activeWeek);
      setWeek(order);
      history.push({
        label,
        undo: () => deleteWeek(block.id, order),
        redo: async () => {
          order = await pasteWeek(sourceId, block.id, activeWeek);
        },
      });
    };
    const edit = (name: string) => {
      setView("phase");
      focusField(name);
    };

    const list: Command[] = [
      {
        id: "week-next",
        group: "Week",
        title: t("Next week"),
        run: () => stepWeek(1),
      },
      {
        id: "week-prev",
        group: "Week",
        title: t("Previous week"),
        run: () => stepWeek(-1),
      },
      {
        id: "week-add",
        group: "Week",
        title: t("Add a week"),
        run: () => {
          setWeek(block.weeks.length + 1);
          startTransition(() => addWeekUndoable(history, block.id, block.weeks.length + 1));
        },
      },
      {
        id: "phase-next",
        group: "Phase",
        title: t("Next phase"),
        run: () => {
          const next = program.phases[phaseIndex + 1];
          if (next) openPhase(next.id);
        },
      },
      {
        id: "phase-prev",
        group: "Phase",
        title: t("Previous phase"),
        run: () => {
          const prev = program.phases[phaseIndex - 1];
          if (prev) openPhase(prev.id);
        },
      },
      ...Array.from({ length: block.weeks.length }, (_, i) => ({
        id: `week-${i + 1}`,
        group: "Week",
        title: t("Go to week {n}", { n: i + 1 }),
        kind: "week" as const,
        run: () => setWeek(i + 1),
      })),
      {
        id: "progressions",
        group: "Program",
        title: t("Apply progressions"),
        keywords: "rewrite weeks rules",
        run: () =>
          startTransition(() => {
            void applyAllProgressions(block.id);
          }),
      },
      {
        id: "program-new",
        group: "Program",
        title: t("New program…"),
        run: () => setPanel("new"),
      },
      {
        id: "program-settings",
        group: "Program",
        title: t("Program settings…"),
        keywords: "rename import export file delete",
        run: () => setPanel("settings"),
      },
      {
        id: "phase-settings",
        group: "Phase",
        title: t("Phase settings…"),
        keywords: "rename dates start 1rm maxes nutrition kcal protein delete",
        run: () => {
          setView("phase");
          setPanel("phase-settings");
        },
      },
      {
        id: "view-tight-intensity",
        group: "View",
        title: tightIntensity ? t("Spread intensity across the week") : t("Keep intensity beside reps"),
        keywords: "columns layout width notes compact wide",
        run: () => togglePref("tightIntensity"),
      },
      // One show/hide per column, as in Settings. TIME also shows itself once a row is timed.
      ...COLUMN_COMMANDS.map(([c, name, keywords]) => ({
        id: `view-${c}`,
        group: "View",
        title: columns[c] ? t("Hide the {name} column", { name: t(name) }) : t("Show the {name} column", { name: t(name) }),
        keywords: `columns ${keywords}`,
        run: () => setPref("columns", { ...columns, [c]: !columns[c] }),
      })),
      {
        id: "view-rest-days",
        group: "View",
        title: hideRest ? t("Show rest days") : t("Hide rest days"),
        keywords: "off days strip collapse",
        run: () => togglePref("hideRestDays"),
      },
      {
        id: "program-rename",
        group: "Program",
        title: t("Rename program"),
        run: () => edit("program-name"),
      },
      {
        id: "phase-rename",
        group: "Phase",
        title: t("Rename phase"),
        run: () => edit("phase-name"),
      },
      {
        id: "phase-maxes",
        group: "Phase",
        title: t("Edit this phase's 1RMs"),
        keywords: "maxes squat bench deadlift sq bp dl",
        run: () => edit("max-squat1RM"),
      },
      {
        id: "phase-add",
        group: "Phase",
        title: t("Add a phase"),
        keywords: "block new next",
        run: () => addPhaseUndoable(history, program.id, openPhase, block.id),
      },
      {
        id: "program-import",
        group: "Program",
        title: t("Import program file…"),
        keywords: "topset json open load",
        run: async () => {
          const file = await pickFile(".json,application/json");
          if (!file) return;
          const result = await importProgram(athlete.id, await file.text());
          if (!result.ok) window.alert(t(result.error));
          else router.push(`/programming?athlete=${athlete.id}&phase=${result.id}`);
        },
      },
      {
        id: "program-copy",
        group: "Program",
        title: t("Copy program…"),
        keywords: "duplicate clone another athlete",
        run: () => setPanel("copy"),
      },
      {
        id: "export-xlsx",
        group: "Export",
        title: t("Export whole program .xlsx"),
        keywords: "excel spreadsheet phases sheets",
        run: () => download(`/api/export?blockId=${block.id}&format=xlsx`),
      },
      {
        id: "print-week",
        group: "Export",
        title: t("Print week {n}", { n: activeWeek }),
        keywords: "paper sheet printable pdf",
        run: () =>
          window.open(`/api/export?blockId=${block.id}&format=print&week=${activeWeek}`, "_blank"),
      },
      {
        id: "print-phase",
        group: "Export",
        title: t("Print every week of this phase"),
        keywords: "paper sheet printable pdf",
        run: () => window.open(`/api/export?blockId=${block.id}&format=print`, "_blank"),
      },
      {
        id: "export-pdf",
        group: "Export",
        title: t("Export .pdf"),
        keywords: "athlete phone",
        run: () => window.open(`/api/export?blockId=${block.id}&format=pdf`, "_blank"),
      },
      {
        id: "export-repwise",
        group: "Export",
        title: t("Export for Repwise (.xlsx)"),
        keywords: "rpecalc google sheet",
        run: () => download(`/api/export?blockId=${block.id}&format=repwise`),
      },
      {
        id: "export-repwise-tsv",
        group: "Export",
        title: t("Export for Repwise (.tsv to paste)"),
        keywords: "rpecalc google sheet clipboard",
        run: () => download(`/api/export?blockId=${block.id}&format=repwise-tsv`),
      },
      {
        id: "export-csv",
        group: "Export",
        title: t("Export .csv"),
        run: () => download(`/api/export?blockId=${block.id}&format=csv`),
      },
    ];

    // Copy and paste, the same as the right-click menus on phase chips and week tabs.
    list.push(
      {
        id: "phase-copy",
        group: "Phase",
        title: t("Copy phase"),
        keywords: "clipboard",
        run: () => setPref("clipboard", { kind: "phase", id: block.id, label: `${program.name} · ${block.phase}` }),
      },
      {
        id: "phase-duplicate",
        group: "Phase",
        title: t("Duplicate phase"),
        keywords: "copy clone",
        run: () => pastePhaseUndoable(history, program.id, openPhase, block.id, block.id, block.id, "duplicate phase"),
      },
    );
    if (copied?.kind === "phase") {
      list.push({
        id: "phase-paste",
        group: "Phase",
        title: t("Paste “{name}” after this phase", { name: copied.label }),
        keywords: "clipboard",
        run: () => pastePhaseUndoable(history, program.id, openPhase, copied.id, block.id, block.id, "paste phase"),
      });
    }
    if (weekData) {
      list.push(
        {
          id: "week-copy",
          group: "Week",
          title: t("Copy week"),
          keywords: "clipboard",
          run: () =>
            setPref("clipboard", { kind: "week", id: weekData.id, label: `${block.phase} · ${t("Week {n}", { n: activeWeek })}` }),
        },
        {
          id: "week-duplicate",
          group: "Week",
          title: t("Duplicate week"),
          keywords: "copy clone",
          run: () => pasteWeekUndoable(weekData.id, "duplicate week"),
        },
      );
      if (copied?.kind === "week") {
        list.push({
          id: "week-paste",
          group: "Week",
          title: t("Paste “{name}” after this week", { name: copied.label }),
          keywords: "clipboard",
          run: () => pasteWeekUndoable(copied.id, "paste week"),
        });
      }
    }

    if (weekData) {
      list.push({
        id: "week-lock",
        group: "Week",
        title: weekData.locked ? t("Unlock week {n}", { n: activeWeek }) : t("Lock week {n}", { n: activeWeek }),
        keywords: "progressions skip freeze deload",
        run: () => {
          const next = !weekData.locked;
          startTransition(() => {
            void setWeekLock(weekData.id, next);
          });
          history.push({
            label: next ? t("lock week {n}", { n: activeWeek }) : t("unlock week {n}", { n: activeWeek }),
            undo: () => setWeekLock(weekData.id, !next),
            redo: () => setWeekLock(weekData.id, next),
          });
        },
      });

      // Resting a whole week keeps its rows; bringing it back trains the days that have some.
      const allRest = weekData.days.every((d) => d.rest);
      const anyRows = weekData.days.some((d) => d.rows.length > 0);
      const before = weekData.days.map((d) => ({ id: d.id, rest: d.rest }));
      const after = weekData.days.map((d) => ({
        id: d.id,
        rest: allRest ? anyRows && d.rows.length === 0 : true,
      }));
      const apply = (days: { id: string; rest: boolean }[]) =>
        Promise.all(days.map((d) => updateDay(d.id, { rest: d.rest })));
      list.push({
        id: "week-rest",
        group: "Week",
        title: allRest ? t("Train week {n} again", { n: activeWeek }) : t("Rest all of week {n}", { n: activeWeek }),
        keywords: "rest day training day vacation off",
        run: () => {
          startTransition(() => {
            void apply(after);
          });
          history.push({
            label: allRest ? t("train week {n}", { n: activeWeek }) : t("rest week {n}", { n: activeWeek }),
            undo: () => apply(before),
            redo: () => apply(after),
          });
        },
      });
    }

    if (block.weeks.length > 1) {
      list.push({
        id: "week-delete",
        group: "Week",
        title: t("Delete week {n}…", { n: activeWeek }),
        keywords: "remove",
        run: () => {
          setView("phase");
          setDeletingWeek(activeWeek);
        },
      });
    }

    if (program.phases.length > 1) {
      list.push({
        id: "phase-delete",
        group: "Phase",
        title: t("Delete phase {name}…", { name: block.phase }),
        keywords: "remove block",
        run: () => {
          setView("phase");
          setPanel("delete-phase");
        },
      });
    }

    const gaps = phaseGaps(program.phases);
    for (const [i, p] of program.phases.entries()) {
      const days = gaps.get(p.id);
      if (days === undefined) continue;
      const previous = program.phases[i - 1].phase;
      list.push({
        id: `gap-${p.id}`,
        group: "Phase",
        title:
          days > 0
            ? t("Close the {gap} before {phase}", { gap: describeGap(days), phase: p.phase })
            : t("Fix the {gap}: start {phase} when {previous} ends", { gap: describeGap(days), phase: p.phase, previous }),
        keywords: "gap break overlap dates start",
        run: () => closeGapUndoable(history, p.id),
      });
    }

    list.push(
      {
        id: "sync-now",
        group: "Sync",
        title: t("Sync now"),
        keywords: "cloud server upload download athletes logged sets refresh",
        run: async () => {
          const result = await syncEverything();
          if (result.ok) router.refresh();
          else window.alert(t(result.message));
        },
      },
      {
        id: "backup-download",
        group: "Backup",
        title: t("Download backup"),
        keywords: "save database everything db",
        run: () => download("/api/backup"),
      },
      {
        id: "backup-restore",
        group: "Backup",
        title: t("Restore backup…"),
        keywords: "load database db",
        run: async () => {
          const file = await pickFile(".db");
          if (!file) return;
          const status = await restoreBackup(file);
          if (status) window.alert(t(status.text));
        },
      },
      {
        id: "athlete-link",
        group: "Athlete",
        title: t("Athlete check-in link…"),
        keywords: "qr phone share athlete app log",
        run: () => router.push(fresh(`/athletes?link=${athlete.id}`)),
      },
      {
        id: "athlete-example",
        group: "Athlete",
        title: t("Add the example athlete"),
        keywords: "demo sample tutorial",
        run: async () => {
          const id = await createExampleAthlete();
          router.push(`/programming?athlete=${id}`);
        },
      },
    );

    list.push({
      id: "whole-program",
      group: "Program",
      title: t("Whole program"),
      kind: "place",
      keywords: "phases timeline overview total",
      run: () => setView("program"),
    });

    for (const p of program.phases) {
      if (p.id === block.id) continue;
      list.push({
        id: `open-phase-${p.id}`,
        group: "Phase",
        title: t("Open phase {name}", { name: p.phase }),
        kind: "place",
        run: () => openPhase(p.id),
      });
    }

    for (const other of programs) {
      if (other.id === program.id) continue;
      const first = other.phases[0];
      if (!first) continue;
      list.push({
        id: `open-program-${other.id}`,
        group: "Program",
        title: t("Open {name}", { name: other.name }),
        kind: "place",
        run: () => {
          setView("phase");
          router.push(`/programming?athlete=${athlete.id}&phase=${first.id}`);
        },
      });
    }

    // Always there, so the keys never fall through to the browser's own undo in a cell:
    // the edit being taken back has already been saved.
    list.push(
      {
        id: "undo",
        group: "Edit",
        title: history.undoLabel ? `${t("Undo")} ${t(history.undoLabel)}` : t("Undo"),
        hidden: !history.undoLabel,
        run: history.undo,
      },
      {
        id: "redo",
        group: "Edit",
        title: history.redoLabel ? `${t("Redo")} ${t(history.redoLabel)}` : t("Redo"),
        hidden: !history.redoLabel,
        run: history.redo,
      },
    );

    list.push(
      {
        id: "go-tracking",
        group: "Go",
        title: t("Tracking for {name}", { name: athlete.name }),
        kind: "place",
        keywords: "logged rpe e1rm compliance",
        run: () => router.push(`/tracking?athlete=${athlete.id}&block=${block.id}`),
      },
      {
        id: "go-competition",
        group: "Go",
        title: t("Competition for {name}", { name: athlete.name }),
        kind: "place",
        keywords: "meet attempts openers total",
        run: () => router.push(`/competition?athlete=${athlete.id}`),
      },
    );

    // Pushed in several passes; keep each group together under one heading.
    const groups = [...new Set(list.map((c) => c.group))];
    return list.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group));
  }, [activeWeek, athlete, tightIntensity, columns, hideRest, copied, view, programOpen, wholeProgram, block, history, program, programs, router]);

  // Above the sidebar's: "Tracking" here knows which phase to open.
  useCommands("workspace", commands, 1);

  return (
    <>
      <Topbar
        programs={programs}
        program={program}
        phase={phase}
        athlete={athlete}
        roster={roster}
        panel={panel}
        onPanel={setPanel}
        view={view}
        onView={setView}
        week={activeWeek}
      />

      {injuries.length > 0 && (
        <Link
          href={`/tracking?athlete=${athlete.id}&view=wellness`}
          title={t("Injuries on file now. Open them in Tracking.")}
          className="mx-6 mt-2 flex w-fit flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-miss/40 bg-miss/10 px-3 py-1.5 text-[12px] hover:border-miss"
        >
          <span className="text-[10px] font-semibold tracking-[0.14em] text-miss">{t("INJURED")}</span>
          {injuries.map((i) => (
            <span key={i.id} className="text-foreground">
              {injuryLabel(i)} <span className="tabular-nums text-muted">{i.severity}/5</span>
            </span>
          ))}
        </Link>
      )}

      {view === "program" ? (
        <WholeProgramSheet
          phases={wholeProgram}
          athlete={athlete}
          exerciseHistory={exerciseHistory}
          meets={meets}
          open={programOpen}
          onOpen={setProgramPos}
        />
      ) : (
        <ProgrammingGrid
          block={block}
          athlete={athlete}
          exerciseHistory={exerciseHistory}
          meets={meets}
          week={activeWeek}
          onWeek={setWeek}
          deletingWeek={deletingWeek}
          onDeletingWeek={setDeletingWeek}
        />
      )}
      <SaveFailed />
    </>
  );
}

/**
 * Edits show before the server has them, and are sent fire-and-forget — so a save that
 * fails surfaces only as an unhandled rejection. Say so, rather than leave the grid
 * showing something that isn't stored.
 */
function SaveFailed() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const onFail = () => setFailed(true);
    window.addEventListener("unhandledrejection", onFail);
    return () => window.removeEventListener("unhandledrejection", onFail);
  }, []);
  if (!failed) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-[200] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-miss/50 bg-surface-2 px-4 py-2.5 text-[12px] shadow-xl shadow-black/50"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-miss" />
      <span className="text-foreground">{t("A change didn't save. Reload to see what is stored.")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white"
      >
        {t("Reload")}
      </button>
      <button type="button" onClick={() => setFailed(false)} className="text-[11px] text-muted-2 hover:text-foreground">
        {t("Dismiss")}
      </button>
    </div>
  );
}
