"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import type { Tier } from "@prisma/client";
import {
  addRow,
  addWeek,
  fillMeetDay,
  applyAllProgressions,
  deleteRow,
  deleteWeek,
  pasteWeek,
  restoreRow,
  duplicateRow,
  insertRow,
  moveRow,
  pasteRows,
  setWeekLock,
  updateBlock,
  updateBlockMaxes,
  updateCell,
  updateDay,
  updateProgram,
  updateRow,
  type RowTemplate,
} from "@/app/programming/actions";
import { inputBase, NumberInput, TextInput } from "@/components/cells";
import { Popover } from "@/components/Popover";
import { Confirm } from "@/components/Confirm";
import { ExerciseInput } from "@/components/ExerciseInput";
import { useHistory } from "@/components/history";
import { useSettings } from "@/components/SettingsProvider";
import { IntensityEditor } from "@/components/IntensityEditor";
import { ProgressionRules } from "@/components/ProgressionRules";
import { meetOn, type MeetSummary } from "@/lib/competition";
import { classifyExercise, isBackoff, resolveAlias } from "@/lib/exercises";
import { maxesOf, resolveDay } from "@/lib/intensity";
import { dayName } from "@/lib/days";
import { formatDate, weekdayOf, weekdayOfDay } from "@/lib/dates";
import { GRID_MIN_WIDTH, SHELL_MAX_WIDTH } from "@/lib/layout";
import { colorOfTarget, setPref, tierShade, usePref, togglePref, type Column } from "@/lib/prefs";
import { activeSettings, TIERS, tierLabel } from "@/lib/settings";
import { claimsKey } from "@/components/CommandCenter";
import { useCommands, type Command } from "@/lib/commands";
import { COMMAND_SPECS, label as keyLabel, primaryKey } from "@/lib/shortcuts";
import { useContextMenu } from "@/components/ContextMenu";
import {
  WEEKDAYS,
  type AthleteData,
  type BlockData,
  type Prescription,
  type DayData,
  type RowData,
} from "@/lib/types";
import { t, weekdayShort } from "@/lib/i18n";

/** The week's columns in the order they sit, left to right. */
type WeekCol = "sets" | "reps" | "intensity" | "tempo" | "rest" | "video" | "notes";

const WEEK_COL_LABEL: Record<WeekCol, string> = {
  sets: "SETS",
  reps: "REPS",
  intensity: "INTENSITY",
  tempo: "TEMPO",
  rest: "REST",
  video: "VIDEO",
  notes: "COACH NOTES",
};

/** The prescription field a text column edits. */
const TEXT_FIELD = { notes: "coachNotes", tempo: "tempo", rest: "restTime", video: "videoUrl" } as const;

/** A keyboard column: the row's own two, then the week's. */
type NavKey = "target" | "exercise" | WeekCol;

/** What copying a column carries. TARGET brings the tier badge that sits in its cell. */
const COL_FIELDS: Record<NavKey, readonly (keyof RowTemplate)[]> = {
  target: ["target", "tier"],
  exercise: ["exercise"],
  sets: ["sets"],
  reps: ["reps"],
  intensity: ["intensityType", "intensity", "intensityMax", "rampStep"],
  tempo: ["tempo"],
  rest: ["restTime"],
  video: ["videoUrl"],
  notes: ["coachNotes"],
};

/**
 * What Ctrl+C or Alt+C last took out of the grid. Rows travel whole — intensity type,
 * ramp and progression rules too — so a paste is exact where the text alone would not
 * be. `cols` is null for whole rows; `text` is what went on the system clipboard, which
 * tells a paste of these rows from a paste of anything else.
 *
 * Kept outside the component so it survives switching week, program or athlete.
 */
type RowClip = { rows: RowTemplate[]; cols: NavKey[] | null; text: string };
let rowClip: RowClip | null = null;

/**
 * The grid's columns for the coach's view settings. The left four are sticky and fixed
 * (PROGRESSION shrinks to nothing when hidden, so the offsets never move); the week
 * absorbs a wide display — INTENSITY a little and COACH NOTES most of it, or all of it
 * in notes when intensity is kept beside reps.
 */
function gridLayout(columns: Record<Column, boolean>, tight: boolean) {
  const cols: WeekCol[] = ["sets", "reps", "intensity"];
  if (columns.tempo) cols.push("tempo");
  if (columns.rest) cols.push("rest");
  if (columns.video) cols.push("video");
  if (columns.notes) cols.push("notes");

  const width: Record<WeekCol, string> = {
    sets: "56px",
    reps: "56px",
    // The kind, the number and the weight they come to, side by side.
    intensity: tight || !columns.notes ? "200px" : "minmax(184px,1fr)",
    tempo: "76px",
    rest: "76px",
    video: "140px",
    notes: tight ? "minmax(202px,1fr)" : "minmax(236px,2fr)",
  };
  if (!columns.notes && !tight) width.intensity = "minmax(200px,1fr)";

  const progression = columns.progression ? 164 : 0;
  return {
    cols,
    showProgression: columns.progression,
    leftWidth: 336 + progression,
    template: `40px 128px 168px ${progression}px ${cols.map((c) => width[c]).join(" ")}`,
    /** Keyboard columns: target, exercise, then the week's. */
    navKeys: ["target", "exercise", ...cols] as const,
  };
}


/** A cell's nav coordinates: its row slot and its column. */
type Coord = [number, number];

/** Rewrites rows wherever they sit in the phase, for an optimistic edit. */
function mapRows(block: BlockData, fn: (row: RowData) => RowData): BlockData {
  return {
    ...block,
    weeks: block.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => ({ ...day, rows: day.rows.map(fn) })),
    })),
  };
}

/** A paste, or its undo, done to the grid on screen ahead of the server. */
function pastedLocally(
  block: BlockData,
  dayId: string,
  write: {
    update?: { id: string; template: RowTemplate }[];
    create?: { id: string; template: RowTemplate }[];
    remove?: string[];
  },
): BlockData {
  const withRules = (template: RowTemplate) => ({
    ...template,
    rules: template.rules.map((rule) => ({ ...rule, id: crypto.randomUUID() })),
  });
  const updates = new Map((write.update ?? []).map((u) => [u.id, u.template]));
  const removed = new Set(write.remove ?? []);
  return {
    ...block,
    weeks: block.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => {
        let rows = day.rows
          .filter((r) => !removed.has(r.id))
          .map((r) => (updates.has(r.id) ? { ...r, ...withRules(updates.get(r.id)!) } : r));
        if (day.id === dayId) {
          for (const { id, template } of write.create ?? []) {
            rows = [...rows, { ...blankRow(id, { ...day, rows }), ...withRules(template) }];
          }
        }
        return { ...day, rows };
      }),
    })),
  };
}

function rectOf(a: Coord, b: Coord) {
  return {
    r1: Math.min(a[0], b[0]),
    r2: Math.max(a[0], b[0]),
    c1: Math.min(a[1], b[1]),
    c2: Math.max(a[1], b[1]),
  };
}

function dayOf(startDate: string, week: number, dayIndex = 0) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + (week - 1) * 7 + dayIndex);
  return d;
}

/**
 * The calendar day a grid cell falls on, as yyyy-mm-dd. Done in UTC on purpose: meet
 * dates are stored at UTC midnight, and local arithmetic would put a coach west of
 * Greenwich on the day before.
 */
function dayYmd(startDate: string, week: number, dayIndex: number) {
  const d = new Date(startDate);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const shifted = midnight + ((week - 1) * 7 + dayIndex) * 24 * 60 * 60 * 1000;
  return new Date(shifted).toISOString().slice(0, 10);
}

function weekDate(startDate: string, week: number) {
  return formatDate(dayOf(startDate, week));
}

function fullDate(startDate: string, week: number, dayIndex: number) {
  const d = dayOf(startDate, week, dayIndex);
  return `${t(WEEKDAYS[weekdayOf(d)])} ${formatDate(d, true)}`;
}

export function ProgrammingGrid({
  block: initialBlock,
  athlete,
  exerciseHistory,
  meets,
  week,
  onWeek,
  deletingWeek,
  onDeletingWeek,
  weekLabel = "tabs",
}: {
  block: BlockData;
  athlete: AthleteData;
  exerciseHistory: string[];
  meets: MeetSummary[];
  week: number;
  onWeek: (week: number) => void;
  /** The week whose delete question is up — lifted so the palette can ask it too. */
  deletingWeek?: number | null;
  onDeletingWeek?: (week: number | null) => void;
  /** "tabs" (default) switches weeks; "static" just marks which week this is — for
   *  showing every week at once, where there's nothing to switch to. */
  weekLabel?: "tabs" | "static";
}) {
  const [block, setBlock] = useState(initialBlock);
  const [synced, setSynced] = useState(initialBlock);
  const [, startTransition] = useTransition();

  /** The rows last copied, waiting for a paste. Mirrors `rowClip` so menus re-render. */
  const [clipboard, setClipboardState] = useState<RowClip | null>(rowClip);
  const setClipboard = (clip: RowClip) => {
    rowClip = clip;
    setClipboardState(clip);
  };
  const rowMenu = useContextMenu();
  const history = useHistory();

  /** Runs an edit and records how to take it back. */
  function edit(label: string, run: () => Promise<unknown>, undo: () => Promise<unknown>) {
    history.push({ label, undo, redo: run });
    startTransition(() => {
      void run();
    });
  }

  // Local edits are optimistic; adopt the server copy whenever a revalidation lands.
  if (synced !== initialBlock) {
    setSynced(initialBlock);
    setBlock(initialBlock);
  }

  const activeWeek = Math.min(week, block.weeks.length);
  const weeks = [activeWeek];
  const maxes = maxesOf(block, athlete);

  // The grid shows one week, and that week owns its days outright.
  const activeWeekData = block.weeks.find((w) => w.order === activeWeek);
  const days = useMemo(() => activeWeekData?.days ?? [], [activeWeekData]);
  // The tutorial points at the first real session on screen.
  const tourDayId = days.find((d) => !d.rest && d.rows.some((r) => r.exercise.trim()))?.id;

  /** Which of this week's days a meet lands on. */
  const meetByDay = useMemo(() => {
    const map = new Map<string, MeetSummary>();
    for (const day of days) {
      const meet = meetOn(meets, dayYmd(block.startDate, activeWeek, day.index));
      if (meet) map.set(day.id, meet);
    }
    return map;
  }, [days, block.startDate, activeWeek, meets]);


  const tightIntensity = usePref("tightIntensity");
  const tierColors = usePref("tierColors");
  const targetColors = usePref("targetColors");
  const columns = usePref("columns");
  const compact = usePref("density") === "compact";
  const cellDisplay = usePref("cellDisplay");
  const hideRestDays = usePref("hideRestDays");
  const { tiers, targets } = useSettings().settings;
  const layout = useMemo(() => gridLayout(columns, tightIntensity), [columns, tightIntensity]);
  const { template, cols, navKeys } = layout;
  const NAV_COLS = navKeys.length;

  /** The selected block of cells, as the two corners the user dragged between. */
  const [sel, setSel] = useState<{ a: Coord; b: Coord } | null>(null);
  const [dragging, setDragging] = useState(false);
  const anchor = useRef<Coord | null>(null);
  /** The row a drag down the row numbers started on. */
  const rowAnchor = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const rect = sel ? rectOf(sel.a, sel.b) : null;
  const spans = rect !== null && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2);
  /** Whole rows are selected, as clicking the row numbers does. */
  const wholeRows = rect !== null && rect.c1 === 0 && rect.c2 === NAV_COLS - 1;

  // Painted on the DOM rather than threaded through six cell call sites, the same way
  // the rest of this grid reaches cells by their nav coordinates.
  useEffect(() => {
    const root = gridRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("[data-nav]")) {
      const [r, c] = el.dataset.nav!.split("-").map(Number);
      const on =
        spans && rect !== null && r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
      el.classList.toggle("bg-accent-soft", on);
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-row-head]")) {
      const r = Number(el.dataset.rowHead);
      const on = wholeRows && rect !== null && r >= rect.r1 && r <= rect.r2;
      el.classList.toggle("!bg-accent", on);
      el.classList.toggle("!text-white", on);
    }
  });

  useEffect(() => {
    function stop() {
      anchor.current = null;
      rowAnchor.current = null;
      setDragging(false);
    }
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  function coordOf(target: EventTarget | null) {
    // A row number stands for its row's first cell.
    const head = (target as HTMLElement | null)?.closest<HTMLElement>("[data-row-head]");
    if (head) return [Number(head.dataset.rowHead), 0] as Coord;
    const holder = (target as HTMLElement | null)?.closest<HTMLElement>("[data-nav]");
    if (!holder?.dataset.nav) return null;
    const [r, c] = holder.dataset.nav.split("-").map(Number);
    return Number.isFinite(r) && Number.isFinite(c) ? ([r, c] as Coord) : null;
  }

  function onGridMouseDown(e: React.MouseEvent) {
    const head = (e.target as HTMLElement).closest<HTMLElement>("[data-row-head]");
    if (head && e.button === 0) {
      // A row number selects its whole row; shift or a drag takes in the rows between.
      e.preventDefault();
      head.focus();
      const r = Number(head.dataset.rowHead);
      const from = e.shiftKey && sel ? sel.a[0] : r;
      rowAnchor.current = from;
      setSel({ a: [from, 0], b: [r, NAV_COLS - 1] });
      return;
    }
    const at = coordOf(e.target);
    if (!at) return;
    if (e.shiftKey && sel) {
      e.preventDefault();
      setSel({ a: sel.a, b: at });
      return;
    }
    // Not a selection yet — a drag only becomes one once it reaches another cell, so
    // click-dragging inside a cell still selects its text.
    anchor.current = at;
    setSel({ a: at, b: at });
  }

  function onGridMouseOver(e: React.MouseEvent) {
    const fromRow = rowAnchor.current;
    if (fromRow !== null && e.buttons === 1) {
      const at = coordOf(e.target);
      if (at) setSel({ a: [fromRow, 0], b: [at[0], NAV_COLS - 1] });
      return;
    }
    const from = anchor.current;
    if (!from || e.buttons !== 1) return;
    const at = coordOf(e.target);
    if (!at || (at[0] === from[0] && at[1] === from[1])) return;
    // The drag started in a text input, so the browser is busy selecting its text as
    // well. Once it leaves the cell it is a range selection and nothing else.
    window.getSelection()?.removeAllRanges();
    setDragging(true);
    setSel({ a: from, b: at });
  }

  /** What a cell shows right now, read off the DOM so it includes uncommitted typing. */
  function readCell(r: number, c: number) {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-nav="${r}-${c}"]`);
    const input = el?.querySelector("input");
    return (input?.value ?? el?.textContent ?? "").trim();
  }

  /**
   * Writes a block of cells as one undoable edit. Columns 0 and 1 belong to the row
   * itself; 2 to 5 are this week's prescription.
   */
  function writeCells(label: string, writes: { r: number; c: number; text: string }[]) {
    const rowPatches = new Map<string, { next: Partial<RowData>; prev: Partial<RowData> }>();
    const cellPatches = new Map<string, { next: Partial<Prescription>; prev: Partial<Prescription> }>();

    for (const { r, c, text } of writes) {
      const row = nav.slots.get(r)?.row;
      if (!row) continue;

      const col = navKeys[c];
      if (col === "target" || col === "exercise") {
        const key = col;
        const entry = rowPatches.get(row.id) ?? { next: {}, prev: {} };
        entry.next[key] = text;
        entry.prev[key] = row[key];
        rowPatches.set(row.id, entry);
        continue;
      }

      if (col === undefined) continue;
      const entry = cellPatches.get(row.id) ?? { next: {}, prev: {} };

      if (col === "notes" || col === "tempo" || col === "rest" || col === "video") {
        const field = TEXT_FIELD[col];
        entry.next[field] = text || null;
        entry.prev[field] = row[field] ?? null;
      } else {
        const key = col;
        const n = text === "" ? null : Number(text.replace(",", "."));
        if (n !== null && !Number.isFinite(n)) continue;
        entry.next[key] = n;
        entry.prev[key] = row[key] ?? null;
      }
      cellPatches.set(row.id, entry);
    }

    if (rowPatches.size === 0 && cellPatches.size === 0) return;

    const apply = (pick: "next" | "prev") => {
      setBlock((b) =>
        mapRows(b, (r) => {
          const rowPatch = rowPatches.get(r.id)?.[pick];
          const cellPatch = cellPatches.get(r.id)?.[pick];
          return rowPatch || cellPatch ? { ...r, ...rowPatch, ...cellPatch } : r;
        }),
      );

      return Promise.all([
        ...[...rowPatches].map(([id, p]) => updateRow(id, p[pick])),
        ...[...cellPatches].map(([id, p]) => updateCell(id, p[pick])),
      ]);
    };

    apply("next");
    history.push({ label, undo: () => apply("prev"), redo: () => apply("next") });
  }

  /**
   * Copies a block of cells: as tab-separated text for other programs, and as the rows
   * themselves for pasting back in here. Returns the text.
   */
  function copyCells(box: { r1: number; r2: number; c1: number; c2: number }): string {
    const lines: string[] = [];
    const rows: RowTemplate[] = [];
    const whole = box.c1 === 0 && box.c2 === NAV_COLS - 1;
    for (let r = box.r1; r <= box.r2; r++) {
      const row = nav.slots.get(r)?.row;
      // Whole rows leave out the unnamed ones: a day only ever has one, at its end.
      if (!row || (whole && isBlank(row))) continue;
      const cols: string[] = [];
      for (let c = box.c1; c <= box.c2; c++) cols.push(readCell(r, c));
      lines.push(cols.join("\t"));
      rows.push(rowTemplate(row));
    }
    const text = lines.join("\n");
    if (rows.length > 0) {
      setClipboard({ rows, cols: whole ? null : (navKeys.slice(box.c1, box.c2 + 1) as NavKey[]), text });
    }
    return text;
  }

  /** Whether a clipboard event is this grid's: the focus is somewhere inside it. */
  function ours() {
    return gridRef.current?.contains(document.activeElement) ?? false;
  }

  function onGridCopy(e: ClipboardEvent) {
    if (!ours() || !spans || !rect || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", copyCells(rect));
  }

  function onGridPaste(e: ClipboardEvent) {
    if (!ours() || !e.clipboardData) return;
    const text = e.clipboardData.getData("text/plain");
    // A single value is the browser's business — only a grid of them is ours.
    if (!text || !/[\t\n]/.test(text)) return;

    const start = rect ? [rect.r1, rect.c1] : coordOf(document.activeElement);
    if (!start) return;
    e.preventDefault();

    // Rows copied out of this grid come back whole, not as the text they showed.
    const clip = rowClip;
    if (clip && clip.text === text.replace(/\r/g, "").replace(/\n$/, "")) {
      if (clip.cols === null) return pasteClip(clip, start[0]);
      if (navKeys[start[1]] === clip.cols[0]) return pasteClip(clip, start[0]);
    }

    const writes: { r: number; c: number; text: string }[] = [];
    text.replace(/\r/g, "").replace(/\n$/, "").split("\n").forEach((line, dr) => {
      line.split("\t").forEach((value, dc) => {
        const c = start[1] + dc;
        if (c < NAV_COLS) writes.push({ r: start[0] + dr, c, text: value.trim() });
      });
    });
    writeCells("paste", writes);
  }

  // On the document, not the grid: a row number has the focus after it is clicked, and a
  // button is no place a copy or paste event is sent to.
  useEffect(() => {
    document.addEventListener("copy", onGridCopy);
    document.addEventListener("paste", onGridPaste);
    return () => {
      document.removeEventListener("copy", onGridCopy);
      document.removeEventListener("paste", onGridPaste);
    };
  });

  /**
   * Pastes copied rows from nav slot `start` down. Whole rows overwrite the rows of that
   * day from there on and add any more at its end, the way a sheet grows; columns only
   * fill rows that are there, so no row is ever made half-written. One undo step.
   */
  function pasteClip(clip: RowClip, start: number) {
    const slot = nav.slots.get(start);
    if (!slot) return;

    const update: { id: string; template: RowTemplate }[] = [];
    const before: { id: string; template: RowTemplate }[] = [];
    const create: { id: string; template: RowTemplate }[] = [];
    let dayId = slot.day.id;

    if (clip.cols === null) {
      const from = slot.row ? slot.day.rows.indexOf(slot.row) : slot.day.rows.length;
      const targets = slot.day.rows.slice(from);
      clip.rows.forEach((template, i) => {
        const target = targets[i];
        if (target) {
          update.push({ id: target.id, template });
          before.push({ id: target.id, template: rowTemplate(target) });
        } else {
          create.push({ id: crypto.randomUUID(), template });
        }
      });
    } else {
      const fields = clip.cols.flatMap((col) => COL_FIELDS[col]);
      clip.rows.forEach((source, i) => {
        const target = nav.slots.get(start + i)?.row;
        if (!target) return;
        const was = rowTemplate(target);
        const template = { ...was, ...Object.fromEntries(fields.map((f) => [f, source[f]])) } as RowTemplate;
        update.push({ id: target.id, template });
        before.push({ id: target.id, template: was });
      });
      dayId = nav.slots.get(start)?.day.id ?? dayId;
    }
    if (update.length === 0 && create.length === 0) return;

    const redo = { update, create };
    const undo = { update: before, remove: create.map((c) => c.id) };
    const apply = (write: typeof redo | typeof undo) => {
      setBlock((b) => pastedLocally(b, dayId, write));
      return pasteRows(dayId, write);
    };
    startTransition(() => {
      void apply(redo);
    });
    history.push({ label: "paste rows", undo: () => apply(undo), redo: () => apply(redo) });

    // The pasted rows stay selected, the way a sheet leaves them.
    const last = start + update.length + create.length - 1;
    setSel(clip.cols === null ? { a: [start, 0], b: [last, NAV_COLS - 1] } : null);
  }

  /**
   * Nav coordinates for every focusable row, each day's ghost row included. Rest days
   * are skipped - their rows aren't rendered, so arrowing into them would dead-end.
   * A day whose last row is still unnamed has no ghost: that row already is one, so
   * walking down a day can never leave a trail of blank rows behind.
   */
  const nav = (() => {
    const rows = new Map<string, number>();
    const ghosts = new Map<string, number>();
    const slots = new Map<number, { day: DayData; row?: RowData }>();
    let i = 0;
    // Always the week on screen — another week's day ids would leave this one with no
    // entry row to type into.
    for (const day of days) {
      if (day.rest) continue;
      for (const row of day.rows) {
        rows.set(row.id, i);
        slots.set(i++, { day, row });
      }
      if (!isBlank(day.rows[day.rows.length - 1])) {
        ghosts.set(day.id, i);
        slots.set(i++, { day });
      }
    }
    return { rows, ghosts, slots, count: i };
  })();

  // Set before a row is added on the server, and consumed once it has rendered.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const slot = pendingFocus.current;
    if (slot === null) return;

    // A row can take two revalidations to settle (the edit that named the row above it,
    // then the insert). Hold the claim until the cell is actually there.
    const el = document.querySelector<HTMLElement>(
      `[data-nav="${slot}"] input, [data-nav="${slot}"] button`,
    );
    if (!el) return;

    pendingFocus.current = null;
    if (document.activeElement === el) return;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [block]);

  /**
   * One row action, named by its command id — the keys, the palette and the right-click
   * menu all come through here. `index` is the row's nav slot.
   */
  function rowAction(id: string, index: number, handled: () => void = () => {}): boolean {
    const slot = nav.slots.get(index);
    if (!slot) return false;

    const { day, row } = slot;
    const act = (fn: () => void) => {
      handled();
      startTransition(fn);
      return true;
    };

    /** Same as `act`, but the edit joins the undo stack. */
    const tracked = (label: string, run: () => Promise<unknown>, undo: () => Promise<unknown>) => {
      handled();
      edit(label, run, undo);
      return true;
    };

    switch (id) {
      case "day-rest":
        return tracked(
          day.rest ? "training day" : "rest day",
          () => updateDay(day.id, { rest: !day.rest }),
          () => updateDay(day.id, { rest: day.rest }),
        );

      case "row-insert": {
        if (!row) {
          handled();
          materialize(day, 1);
          return true;
        }
        pendingFocus.current = `${index + 1}-1`;
        const id = crypto.randomUUID();
        return tracked(
          "insert row",
          () => insertRow(day.id, row.order, { id }),
          () => deleteRow(id),
        );
      }

      case "row-duplicate": {
        if (!row) return false;
        pendingFocus.current = `${index + 1}-1`;
        const copy = crypto.randomUUID();
        return tracked(
          "duplicate row",
          () => duplicateRow(row.id, copy),
          () => deleteRow(copy),
        );
      }

      case "row-delete": {
        if (!row) return false;
        const snapshot = {
          ...rowTemplate(row),
          id: row.id,
          dayId: day.id,
          order: row.order,
          fromId: row.fromId,
        };
        return tracked(
          "delete row",
          () => deleteRow(row.id),
          () => restoreRow(snapshot),
        );
      }

      case "row-up":
      case "row-down": {
        if (!row) return false;
        const up = id === "row-up";
        return tracked(
          "move row",
          () => moveRow(row.id, up ? "up" : "down"),
          () => moveRow(row.id, up ? "down" : "up"),
        );
      }

      case "meet-fill": {
        const meet = meetByDay.get(day.id);
        if (!meet) return false;
        return act(() => {
          void fillMeetDay(day.id, meet.id);
        });
      }

      case "row-copy": {
        if (!row) return false;
        handled();
        // The selected rows when this one is among them, else just this one.
        const box =
          rect && spans && index >= rect.r1 && index <= rect.r2
            ? { r1: rect.r1, r2: rect.r2, c1: 0, c2: NAV_COLS - 1 }
            : { r1: index, r2: index, c1: 0, c2: NAV_COLS - 1 };
        const text = copyCells(box);
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        return true;
      }

      case "row-paste": {
        const clip = rowClip;
        if (clip === null) return false;
        handled();
        // Always whole rows: what was copied is the whole of each row, whatever showed.
        pasteClip({ ...clip, cols: null }, index);
        return true;
      }

      default:
        return false;
    }
  }

  // The row commands, for the keys and the palette: each acts on the row with focus,
  // which the palette hands back before it runs one.
  const latestRowAction = useRef(rowAction);
  useEffect(() => {
    latestRowAction.current = rowAction;
  });
  const rowCommands = useMemo<Command[]>(
    () =>
      COMMAND_SPECS.filter((spec) => spec.when === "grid").map((spec) => ({
        id: spec.id,
        group: spec.group,
        title: t(spec.title),
        when: "grid",
        run: () => {
          const at = coordOf(document.activeElement);
          if (at) latestRowAction.current(spec.id, at[0]);
        },
      })),
    // coordOf only reads the DOM.
    [],
  );
  useCommands("grid", rowCommands);

  /** The spreadsheet keys: Tab across, shift+arrows to select, fill down, clear. */
  function onSheetKey(e: React.KeyboardEvent): boolean {
    const at = coordOf(e.target);
    if (!at) return false;
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === "Tab") {
      const c = at[1] + (e.shiftKey ? -1 : 1);
      if (c < 0 || c >= NAV_COLS) return false;
      e.preventDefault();
      setSel({ a: [at[0], c], b: [at[0], c] });
      focusNav(`${at[0]}-${c}`);
      return true;
    }

    if (mod && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      // With a block selected the top row fills the rest; with one cell, the cell above
      // fills into it.
      const box = spans && rect ? rect : { r1: at[0] - 1, r2: at[0], c1: at[1], c2: at[1] };
      if (box.r1 < 0) return true;
      const writes: { r: number; c: number; text: string }[] = [];
      for (let c = box.c1; c <= box.c2; c++) {
        const source = readCell(box.r1, c);
        for (let r = box.r1 + 1; r <= box.r2; r++) writes.push({ r, c, text: source });
      }
      writeCells("fill down", writes);
      return true;
    }

    if (e.shiftKey && e.key.startsWith("Arrow")) {
      const head = sel ? sel.b : at;
      const d =
        e.key === "ArrowDown"
          ? [1, 0]
          : e.key === "ArrowUp"
            ? [-1, 0]
            : e.key === "ArrowRight"
              ? [0, 1]
              : [0, -1];
      const next: Coord = [head[0] + d[0], head[1] + d[1]];
      if (next[0] < 0 || next[0] >= nav.count || next[1] < 0 || next[1] >= NAV_COLS) return true;
      e.preventDefault();
      setSel({ a: sel?.a ?? at, b: next });
      return true;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && spans && rect) {
      e.preventDefault();
      const writes: { r: number; c: number; text: string }[] = [];
      for (let r = rect.r1; r <= rect.r2; r++)
        for (let c = rect.c1; c <= rect.c2; c++) writes.push({ r, c, text: "" });
      writeCells("clear cells", writes);
      return true;
    }

    return false;
  }

  /** Arrows walk the grid; left/right only jump once the caret is at the edge of the text. */
  function onNavKey(e: React.KeyboardEvent) {
    // A cell that already handled the key (a suggestion list, say) keeps it.
    if (e.defaultPrevented) return;
    // A key bound to a command (Alt+↑ moves the row) is the keyboard layer's, not a move.
    if (claimsKey(e)) return;
    if (onSheetKey(e)) return;

    const el = e.target as HTMLElement;
    if (el.tagName === "SELECT") return;

    const holder = el.closest<HTMLElement>("[data-nav]");
    if (!holder?.dataset.nav) return;

    const [r, c] = holder.dataset.nav.split("-").map(Number);
    const input = el instanceof HTMLInputElement ? el : null;
    let next: [number, number];

    if (e.key === "ArrowDown" || e.key === "Enter") next = [r + 1, c];
    else if (e.key === "ArrowUp") next = [r - 1, c];
    else if (e.key === "ArrowLeft") {
      if (input && (input.selectionStart ?? 0) > 0) return;
      next = [r, c - 1];
    } else if (e.key === "ArrowRight") {
      if (input && (input.selectionEnd ?? 0) < input.value.length) return;
      next = [r, c + 1];
    } else return;

    const [nr, nc] = next;
    if (nr < 0 || nc < 0 || nc >= NAV_COLS) return;

    const exists =
      nr < nav.count &&
      document.querySelector(`[data-nav="${nr}-${nc}"] input, [data-nav="${nr}-${nc}"] button`);

    if (!exists) {
      // Nothing below — the end of the last day. Enter writes the next row rather than
      // stopping dead, unless this row is still unnamed: that one already is the blank.
      // The name is read off the DOM, not off `block`: Enter commits the cell it is
      // leaving, and that edit has not reached state yet when this runs.
      const here = nav.slots.get(r);
      const named =
        (document.querySelector<HTMLInputElement>(`[data-nav="${r}-1"] input`)?.value ?? "")
          .trim() !== "";

      if (e.key === "Enter" && here && named) {
        e.preventDefault();
        materialize(here.day, nc, r + 1);
      }
      return;
    }

    e.preventDefault();
    // Moving on drops a selection, as it does in a sheet.
    setSel({ a: [nr, nc], b: [nr, nc] });
    focusNav(`${nr}-${nc}`);
  }

  function patchCell(rowId: string, patch: Partial<Prescription>) {
    // The same keys, as they were, is the inverse of any cell edit.
    const previous = days.flatMap((d) => d.rows).find((r) => r.id === rowId);

    const before = Object.fromEntries(
      Object.keys(patch).map((key) => [key, previous?.[key as keyof Prescription] ?? null]),
    ) as Partial<Prescription>;

    setBlock((b) => mapRows(b, (r) => (r.id === rowId ? { ...r, ...patch } : r)));

    edit(
      "cell",
      () => updateCell(rowId, patch),
      () => updateCell(rowId, before),
    );
  }

  /**
   * The ghost row turns into a real one the moment it takes focus, and hands the focus
   * to the same column. The render is flushed inside the focus event so the real input
   * is already in the DOM before the next keystroke arrives - otherwise a coach who
   * clicks and types straight away loses the first characters.
   */
  function materialize(day: DayData, col: number, at?: number) {
    const id = crypto.randomUUID();
    const slot = at ?? nav.ghosts.get(day.id);

    flushSync(() => {
      setBlock((b) => ({
        ...b,
        weeks: b.weeks.map((w) => ({
          ...w,
          days: w.days.map((d) =>
            d.id === day.id ? { ...d, rows: [...d.rows, blankRow(id, d)] } : d,
          ),
        })),
      }));
    });

    // Focused now for the optimistic row, and claimed so a revalidation landing mid-flight
    // hands the caret back rather than dropping it.
    pendingFocus.current = `${slot}-${col}`;
    focusNav(`${slot}-${col}`);

    edit(
      "new row",
      () => addRow(day.id, { id, exercise: "" }),
      () => deleteRow(id),
    );
  }

  /**
   * Naming an exercise fills TARGET and the tier with it - but only while both are
   * still the defaults, so a classification the coach set by hand survives a rename.
   */
  function commitExercise(row: RowData, typed: string | null, picked: boolean) {
    const name = typed === null ? null : resolveAlias(typed);
    const { newRow } = activeSettings();
    const untouched = row.target === newRow.target && row.tier === newRow.tier;
    // A back-off follows the lift above it: its own tier, that lift's target.
    const day = block.weeks.flatMap((w) => w.days).find((d) => d.rows.some((r) => r.id === row.id));
    const above = day?.rows.filter((r) => r.order < row.order && r.exercise.trim() !== "").at(-1);
    const patch =
      name !== null && isBackoff(name)
        ? { exercise: name, tier: "BACKOFF" as const, target: above?.target ?? row.target }
        : name !== null && (picked || untouched)
          ? { exercise: name, ...classifyExercise(name) }
          : { exercise: name ?? "" };

    const before = { exercise: row.exercise, target: row.target, tier: row.tier };

    setBlock((b) => mapRows(b, (r) => (r.id === row.id ? { ...r, ...patch } : r)));

    edit(
      "exercise",
      () => updateRow(row.id, patch),
      () => updateRow(row.id, before),
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {weekLabel === "tabs" && (
        <WeekTabs
          weeks={block.weeks}
          active={activeWeek}
          blockId={block.id}
          onSelect={onWeek}
          onAdded={() => onWeek(block.weeks.length + 1)}
          deleting={deletingWeek}
          onDeleting={onDeletingWeek}
          phaseLabel={block.phase}
        />
      )}

      <div className="flex-1 overflow-auto" style={{ scrollbarGutter: "stable" }}>
        <div
          ref={gridRef}
          style={{ minWidth: GRID_MIN_WIDTH, maxWidth: SHELL_MAX_WIDTH }}
          className={`mx-auto w-full pb-24 ${dragging ? "select-none" : ""}`}
          onKeyDown={onNavKey}
          onMouseDown={onGridMouseDown}
          onMouseOver={onGridMouseOver}
        >
          <Header
            template={template}
            week={activeWeek}
            startDate={block.startDate}
            block={block}
            athlete={athlete}
            weekId={activeWeekData?.id}
            locked={activeWeekData?.locked ?? false}
            leftWidth={layout.leftWidth}
            weekSpan={cols.length}
          />

          {hideRestDays && (
            <DayStrip
              days={days}
              startDate={block.startDate}
              onTrain={(day) =>
                edit(
                  "training day",
                  () => updateDay(day.id, { rest: false }),
                  () => updateDay(day.id, { rest: true }),
                )
              }
            />
          )}

        {days.map((day) => {
          if (hideRestDays && day.rest) return null;
          const weekday = t(WEEKDAYS[weekdayOfDay(block.startDate, day.index)]);
          const resolvedDay = resolveDay(day.rows, maxes);
          const tourDay = day.id === tourDayId;
          return (
            <section
              key={day.id}
              data-tour={tourDay ? "day" : undefined}
              id={`day-${day.id}`}
              className={day.rest ? "mt-1" : compact ? "mt-2" : "mt-4"}
            >
              <div
                onContextMenu={(e) =>
                  rowMenu.open(e, [
                    {
                      label: day.rest ? t("Make it a training day") : t("Make it a rest day"),
                      onSelect: () =>
                        edit(
                          day.rest ? "training day" : "rest day",
                          () => updateDay(day.id, { rest: !day.rest }),
                          () => updateDay(day.id, { rest: day.rest }),
                        ),
                    },
                    {
                      label: t("Rename the day"),
                      disabled: day.rest,
                      onSelect: () => {
                        const input = document.querySelector<HTMLInputElement>(`#day-${day.id} [data-day-name] input`);
                        input?.focus();
                        input?.select();
                      },
                    },
                    {
                      label: t("Add an exercise"),
                      disabled: day.rest,
                      onSelect: () => materialize(day, 1),
                    },
                    ...(meetByDay.get(day.id)
                      ? [
                          {
                            label: t("Fill a meet day with its attempts"),
                            onSelect: () =>
                              startTransition(() => {
                                void fillMeetDay(day.id, meetByDay.get(day.id)!.id);
                              }),
                          },
                        ]
                      : []),
                  ])
                }
                className={`group/day sticky left-0 z-10 flex w-fit items-center gap-2 ${
                  day.rest
                    ? "mx-4 min-w-[260px] rounded-md border border-border bg-surface/60 px-3 py-1.5"
                    : "px-4 py-2"
                }`}
              >
                {day.rest ? (
                  // The day's own name waits underneath for it to be trained on again.
                  <span title={fullDate(block.startDate, activeWeek, day.index)} className="flex items-baseline gap-2 text-[12px]">
                    <span className="text-foreground">{weekday}</span>
                    <span className="text-muted">{dayName(day)}</span>
                  </span>
                ) : (
                  <span data-day-name className="contents">
                  <TextInput
                    value={day.label}
                    className="!w-[150px] !text-[13px] font-semibold"
                    onCommit={(v) => {
                      const label = v ?? "Untitled";
                      const was = day.label;
                      edit(
                        "day name",
                        () => updateDay(day.id, { label }),
                        () => updateDay(day.id, { label: was }),
                      );
                    }}
                  />
                  </span>
                )}
                {!day.rest && (
                  <span title={fullDate(block.startDate, activeWeek, day.index)} className="cursor-help text-[11px] text-muted-2">
                    {weekday}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    edit(
                      day.rest ? "training day" : "rest day",
                      () => updateDay(day.id, { rest: !day.rest }),
                      () => updateDay(day.id, { rest: day.rest }),
                    )
                  }
                  title={day.rest ? t("Make it a training day (Alt+R)") : t("Make it a rest day (Alt+R)")}
                  className={`ml-auto rounded px-1.5 py-0.5 text-[10px] tracking-wider text-muted-2 opacity-0 hover:text-foreground focus:opacity-100 group-hover/day:opacity-100 ${
                    day.rest ? "hover:bg-surface-2" : "border border-border"
                  }`}
                >
                  {day.rest ? `+ ${t("TRAIN")}` : t("MAKE REST DAY")}
                </button>

                {meetByDay.get(day.id) && (
                  <>
                    <span
                      title={t("{name} — competition day", { name: meetByDay.get(day.id)!.name })}
                      className="rounded border border-accent/60 bg-accent-soft px-1.5 py-0.5 text-[11px] tracking-wider text-accent"
                    >
                      MEET · {meetByDay.get(day.id)!.name}
                    </span>
                    <button
                      type="button"
                      title={t("Write the nine attempts onto this day (Alt+M)")}
                      onClick={() =>
                        startTransition(() => {
                          void fillMeetDay(day.id, meetByDay.get(day.id)!.id);
                        })
                      }
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] tracking-wider text-muted-2 hover:border-accent hover:text-accent"
                    >
                      {t("FILL ATTEMPTS")}
                    </button>
                  </>
                )}
              </div>

              {!day.rest && (
                <div className="rounded-lg border-y border-border bg-surface">
                  <div className="grid items-stretch" style={{ gridTemplateColumns: template }}>
                    <StickyCell left={0} width={layout.leftWidth} span={4} className="border-r border-border" />
                    {weeks.map((w) => (
                      <div
                        key={w}
                        style={{ gridColumn: `span ${cols.length}` }}
                        className="flex items-center gap-1.5 border-r border-border px-2 pt-2 text-[10px] font-medium tracking-[0.16em] text-accent"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        {t("TARGET")}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid items-stretch border-b border-border text-[11px] tracking-[0.12em] text-muted-2"
                    style={{ gridTemplateColumns: template }}
                  >
                    <StickyCell left={0} width={40} className="px-2 py-2">
                      #
                    </StickyCell>
                    <StickyCell left={40} width={128} className="px-2 py-2">
                      {t("TARGET")}
                    </StickyCell>
                    <StickyCell left={168} width={168} className="px-2 py-2">
                      {t("EXERCISE")}
                    </StickyCell>
                    <StickyCell
                      left={336}
                      width={layout.leftWidth - 336}
                      className={`overflow-hidden border-r border-border ${layout.showProgression ? "px-2 py-2" : ""}`}
                    >
                      {layout.showProgression && t("PROGRESSION")}
                    </StickyCell>
                    {weeks.map((w) => (
                      <SubHeader key={w} cols={cols} />
                    ))}
                  </div>

                  {day.rows.map((row, i) => {
                    const r = nav.rows.get(row.id)!;
                    // The trailing unnamed row is the day's ghost, already backed by a record.
                    const ghost = i === day.rows.length - 1 && isBlank(row);
                    // Its defaults stay out of sight until the row is pointed at or typed in.
                    const ghostHide = ghost
                      ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      : "";
                    // A coloured target tints its row and fills its badge, quieter the further the
                    // tier is from the main lift; otherwise the tier's colour marks the badge
                    // alone, and an accessory keeps it out of the way.
                    const own = ghost ? null : colorOfTarget(targetColors, row.target);
                    const tint = own === null ? null : tierShade(own, row.tier);
                    const quietBadge = !tint && row.tier === "ACCESSORY";
                    return (
                      <div
                        key={row.id}
                        onContextMenu={(e) => {
                          const k = (id: string) => {
                            const key = primaryKey(id);
                            return key ? keyLabel(key) : undefined;
                          };
                          const run = (id: string) => () => rowAction(id, r);
                          // How many rows a copy from here takes: the selection, if this row is in it.
                          const picked =
                            rect && spans && r >= rect.r1 && r <= rect.r2
                              ? [...Array(rect.r2 - rect.r1 + 1).keys()].filter((k) => {
                                  const row = nav.slots.get(rect.r1 + k)?.row;
                                  return row !== undefined && !isBlank(row);
                                }).length
                              : 1;
                          rowMenu.open(e, [
                            { label: t("Insert a row below"), hint: k("row-insert"), onSelect: run("row-insert") },
                            { label: t("Duplicate the row"), hint: k("row-duplicate"), onSelect: run("row-duplicate"), disabled: ghost },
                            "divider",
                            {
                              label:
                                picked > 1 ? t("Copy the {n} selected rows", { n: picked }) : t("Copy the row's prescription"),
                              hint: k("row-copy"),
                              onSelect: run("row-copy"),
                              disabled: ghost && picked <= 1,
                            },
                            {
                              label:
                                clipboard !== null && clipboard.rows.length > 1
                                  ? t("Paste {n} rows from here down", { n: clipboard.rows.length })
                                  : t("Paste it onto this row"),
                              hint: k("row-paste"),
                              onSelect: run("row-paste"),
                              disabled: clipboard === null,
                            },
                            "divider",
                            { label: t("Move the row up"), hint: k("row-up"), onSelect: run("row-up"), disabled: i === 0 },
                            { label: t("Move the row down"), hint: k("row-down"), onSelect: run("row-down"), disabled: i === day.rows.length - 1 },
                            "divider",
                            { label: day.rest ? t("Make it a training day") : t("Make it a rest day"), hint: k("day-rest"), onSelect: run("day-rest") },
                            ...(meetByDay.get(day.id)
                              ? [{ label: t("Fill a meet day with its attempts"), hint: k("meet-fill"), onSelect: run("meet-fill") }]
                              : []),
                            "divider",
                            { label: t("Delete the row"), hint: k("row-delete"), onSelect: run("row-delete"), danger: true, disabled: ghost },
                          ]);
                        }}
                        className={`group grid items-stretch border-b border-border/60 last:border-b-0 ${
                          tint ? "bg-[color-mix(in_srgb,var(--tint)_9%,transparent)]" : "hover:bg-surface-2/60"
                        } ${ghost ? "border-t border-dashed border-t-border" : ""}`}
                        style={{ gridTemplateColumns: template, ...(tint ? { "--tint": tint } : {}) } as React.CSSProperties}
                      >
                        <StickyCell
                          left={0}
                          width={40}
                          tinted={Boolean(tint)}
                          className={`flex items-center justify-center gap-0.5 text-[11px] text-muted-2 ${tint ? "shadow-[inset_2px_0_0_var(--tint)]" : ""}`}
                        >
                          <button
                            type="button"
                            data-row-head={r}
                            title={t("Select the row. Drag or ⇧-click for more, then Ctrl+C / Ctrl+V.")}
                            className="min-w-[18px] cursor-pointer rounded px-0.5 hover:bg-surface-3 hover:text-foreground focus:outline-none"
                          >
                            {ghost ? "+" : i + 1}
                          </button>
                          <button
                            type="button"
                            title={t("Delete row")}
                            onClick={() => {
                              const snapshot = {
                                ...rowTemplate(row),
                                id: row.id,
                                dayId: day.id,
                                order: row.order,
                                fromId: row.fromId,
                              };
                              edit(
                                "delete row",
                                () => deleteRow(row.id),
                                () => restoreRow(snapshot),
                              );
                            }}
                            className={`hidden text-accent ${ghost ? "" : "group-hover:block"}`}
                          >
                            ×
                          </button>
                        </StickyCell>

                        <StickyCell
                          left={40}
                          width={128}
                          tinted={Boolean(tint)}
                          className={`flex items-center gap-2 pl-2 ${compact ? "py-0.5" : "py-1.5"}`}
                        >
                          <TierPicker
                            tier={row.tier}
                            offered={TIERS.filter((t) => tiers[t].show || t === row.tier)}
                            colorOf={(t) => (own === null ? tierColors[t] : tierShade(own, t))}
                            className={`${ghostHide} ${
                              quietBadge ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" : ""
                            }`}
                            onPick={(tier) => {
                              const was = row.tier;
                              if (tier === was) return;
                              edit(
                                "tier",
                                () => updateRow(row.id, { tier }),
                                () => updateRow(row.id, { tier: was }),
                              );
                            }}
                          />
                          <span data-nav={`${r}-0`} className={`block min-w-0 flex-1 ${ghostHide}`}>
                            <TextInput
                              value={row.target}
                              suggestions={targets}
                              className="!px-0 !py-0 !text-[12px]"
                              onCommit={(v) => {
                                const target = v ?? "General";
                                const was = row.target;
                                edit(
                                  "target",
                                  () => updateRow(row.id, { target }),
                                  () => updateRow(row.id, { target: was }),
                                );
                              }}
                            />
                          </span>
                        </StickyCell>

                        <StickyCell left={168} width={168} nav={`${r}-1`} tinted={Boolean(tint)} className="flex items-center">
                          <ExerciseInput
                            value={row.exercise}
                            history={exerciseHistory}
                            className="font-medium"
                            onCommit={(v, picked) => commitExercise(row, v, picked)}
                          />
                        </StickyCell>

                        <StickyCell
                          left={336}
                          width={layout.leftWidth - 336}
                          tinted={Boolean(tint)}
                          tour={tourDay && i === 0 ? "progression" : undefined}
                          className="flex items-center overflow-hidden border-r border-border"
                        >
                          <div className={`w-full ${ghostHide} ${layout.showProgression ? "" : "hidden"}`}>
                            <ProgressionRules
                              rowId={row.id}
                              rules={row.rules}
                              weeks={block.weeks.length}
                              intensityType={row.intensityType}
                            />
                          </div>
                        </StickyCell>

                        {weeks.map((w) => {
                          const cell = row;

                          const resolved = resolvedDay.get(row.id) ?? {
                            label: "—",
                            weight: null,
                            ramp: [],
                          };
                          // The kind and the number are typed into the cell itself; beside them, the
                          // weight they work out to — unless the coach asked for the prescription
                          // alone, or it would only repeat a fixed weight.
                          const shown =
                            cellDisplay === "intensity" || resolved.weight === null
                              ? null
                              : cell.intensityType === "WEIGHT" && !cell.rampStep
                                ? null
                                : resolved.label;

                          return (
                            <div key={w} className="contents">
                              {cols.map((col, k) => {
                                const at = `${r}-${k + 2}`;
                                const last = k === cols.length - 1 ? "border-r border-border" : "";
                                if (col === "sets" || col === "reps") {
                                  return (
                                    <GridCell key={col} nav={at} className={`${ghostHide} ${last}`}>
                                      <NumberInput
                                        value={cell[col]}
                                        onCommit={(v) => patchCell(row.id, { [col]: v })}
                                      />
                                    </GridCell>
                                  );
                                }
                                if (col === "intensity") {
                                  return (
                                    <GridCell
                                      key={col}
                                      nav={at}
                                      tour={tourDay && i === 0 ? "intensity" : undefined}
                                      className={`${ghostHide} ${last}`}
                                    >
                                      <IntensityEditor
                                        value={cell}
                                        resolved={shown}
                                        onCommit={(v) => patchCell(row.id, v)}
                                      />
                                    </GridCell>
                                  );
                                }
                                const field = TEXT_FIELD[col];
                                return (
                                  <GridCell
                                    key={col}
                                    nav={at}
                                    className={`${col === "notes" ? "" : ghostHide} ${last}`}
                                  >
                                    <TextInput
                                      value={cell[field]}
                                      placeholder={col === "notes" ? t("add note") : col === "video" ? t("link") : "—"}
                                      className={
                                        col === "notes"
                                          ? "!text-[11px] italic text-muted"
                                          : col === "video"
                                            ? "!text-[11px] text-muted"
                                            : "text-center !text-[12px]"
                                      }
                                      onCommit={(v) => patchCell(row.id, { [field]: v })}
                                    />
                                    {col === "video" && cell.videoUrl && (
                                      <a
                                        href={cell.videoUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={t("Open the video")}
                                        className="shrink-0 px-1.5 text-[12px] text-muted-2 hover:text-accent"
                                      >
                                        ↗
                                      </a>
                                    )}
                                  </GridCell>
                                );
                              })}
                            </div>
                          );
                        })}

                      </div>
                    );
                  })}

                  {nav.ghosts.has(day.id) && (
                    <GhostRow
                      template={template}
                      cols={cols}
                      progressionWidth={layout.leftWidth - 336}
                      slot={nav.ghosts.get(day.id)!}
                      onEnter={(col) => materialize(day, col)}
                    />
                  )}
                </div>
              )}
            </section>
          );
        })}
        </div>
      </div>
      {rowMenu.menu}
    </div>
  );
}

/** The tier as a numbered badge in its colour; a click opens the tiers, each in theirs. */
function TierPicker({
  tier,
  offered,
  colorOf,
  onPick,
  className = "",
}: {
  tier: Tier;
  offered: Tier[];
  colorOf: (tier: Tier) => string;
  onPick: (tier: Tier) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const badge = (t: Tier) => (
    <span
      className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] text-[10px] font-semibold text-white"
      style={{ backgroundColor: colorOf(t) }}
    >
      {TIERS.indexOf(t) + 1}
    </span>
  );
  return (
    <>
      <button
        ref={ref}
        type="button"
        title={tierLabel(tier)}
        aria-label={t("Tier")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`shrink-0 rounded-[4px] outline-none focus-visible:ring-1 focus-visible:ring-accent ${className}`}
      >
        {badge(tier)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={176}>
        <div role="menu" className="-m-1">
          {offered.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === tier}
              onClick={() => {
                setOpen(false);
                onPick(option);
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] ${
                option === tier ? "bg-surface-3 text-foreground" : "text-muted hover:bg-surface-3 hover:text-foreground"
              }`}
            >
              {badge(option)}
              <span className="flex-1">{tierLabel(option)}</span>
              {option === tier && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function focusNav(slot: string) {
  // A field to type in when the cell has one — intensity leads with its type button.
  const el =
    document.querySelector<HTMLElement>(`[data-nav="${slot}"] input`) ??
    document.querySelector<HTMLElement>(`[data-nav="${slot}"] button`);
  el?.focus();
  if (el instanceof HTMLInputElement) el.select();
}

/** What Alt+C puts on the clipboard: the row minus its identity and its place. */
function rowTemplate(row: RowData): RowTemplate {
  return {
    tier: row.tier,
    target: row.target,
    exercise: row.exercise,
    rules: row.rules.map((rule) => ({
      order: rule.order,
      field: rule.field,
      op: rule.op,
      amount: rule.amount,
      everyWeeks: rule.everyWeeks,
      startWeek: rule.startWeek,
      endWeek: rule.endWeek,
      enabled: rule.enabled,
    })),
    sets: row.sets,
    reps: row.reps,
    intensityType: row.intensityType,
    intensity: row.intensity,
    intensityMax: row.intensityMax,
    rampStep: row.rampStep,
    coachNotes: row.coachNotes,
    tempo: row.tempo,
    restTime: row.restTime,
    videoUrl: row.videoUrl,
  };
}

/** An unnamed row: the grid treats it as the day's ghost and exports leave it out. */
function isBlank(row: RowData | undefined) {
  return row !== undefined && row.exercise.trim() === "";
}

/** A row's optimistic shape, matching what `addRow` writes on the server. */
function blankRow(id: string, day: DayData): RowData {
  const { newRow } = activeSettings();
  return {
    id,
    order: (day.rows[day.rows.length - 1]?.order ?? -1) + 1,
    rules: [],
    tier: newRow.tier,
    target: newRow.target,
    exercise: "",
    fromId: null,
    sets: newRow.sets,
    reps: newRow.reps,
    intensityType: newRow.intensityType,
    intensity: newRow.intensity,
    intensityMax: null,
    rampStep: null,
    coachNotes: null,
    tempo: null,
    restTime: null,
    videoUrl: null,
    actualWeight: null,
    performedRpe: null,
    athleteNotes: null,
  };
}

/**
 * The permanent last line of every training day. It looks like a row and navigates
 * like one; focusing any of its cells - by click or by arrow key - creates the row
 * for real and hands the focus to the same column.
 */
function GhostRow({
  template,
  cols,
  progressionWidth,
  slot,
  onEnter,
}: {
  template: string;
  cols: WeekCol[];
  progressionWidth: number;
  slot: number;
  onEnter: (col: number) => void;
}) {
  function cell(col: number, placeholder: string, align = "text-center") {
    return (
      <input
        readOnly
        value=""
        placeholder={placeholder}
        onFocus={() => onEnter(col)}
        className={`${inputBase} ${align} cursor-text`}
      />
    );
  }

  return (
    <div
      className="grid items-stretch border-t border-dashed border-border opacity-60 focus-within:opacity-100 hover:opacity-100"
      style={{ gridTemplateColumns: template }}
    >
      <StickyCell left={0} width={40} className="grid place-items-center text-[13px] text-muted-2">
        +
      </StickyCell>
      <StickyCell left={40} width={128} className="flex items-center py-1.5 pl-2">
        <span data-nav={`${slot}-0`} className="block w-full">
          {cell(0, t("target"), "text-left")}
        </span>
      </StickyCell>
      <StickyCell left={168} width={168} nav={`${slot}-1`} className="flex items-center">
        {cell(1, t("add exercise"), "text-left")}
      </StickyCell>
      <StickyCell left={336} width={progressionWidth} className="flex items-center border-r border-border">
        {null}
      </StickyCell>
      {cols.map((col, k) => (
        <GridCell
          key={col}
          nav={`${slot}-${k + 2}`}
          className={k === cols.length - 1 ? "border-r border-border" : ""}
        >
          {cell(k + 2, col === "notes" ? t("add note") : "—", col === "notes" ? "text-left" : "text-center")}
        </GridCell>
      ))}
    </div>
  );
}

function WeekTabs({
  weeks,
  active,
  blockId,
  onSelect,
  onAdded,
  deleting,
  onDeleting,
  phaseLabel,
}: {
  /** The phase's name, for what a copied week is called on the clipboard. */
  phaseLabel: string;
  weeks: { id: string; order: number; locked: boolean }[];
  active: number;
  blockId: string;
  onSelect: (week: number) => void;
  onAdded: () => void;
  deleting?: number | null;
  onDeleting?: (week: number | null) => void;
}) {
  const [, startTransition] = useTransition();
  const [ownConfirmWeek, setOwnConfirmWeek] = useState<number | null>(null);
  const tightIntensity = usePref("tightIntensity");
  const confirmWeek = deleting !== undefined ? deleting : ownConfirmWeek;
  const setConfirmWeek = onDeleting ?? setOwnConfirmWeek;
  const confirmAnchor = useRef<HTMLButtonElement | null>(null);
  const history = useHistory();
  const strip = useRef<HTMLDivElement>(null);
  const weekMenu = useContextMenu();
  const copied = usePref("clipboard");
  const copiedWeek = copied?.kind === "week" ? copied : null;

  /** Pastes the copied week after `after` (the end when undefined) and opens it. */
  function paste(after?: number) {
    if (!copiedWeek) return;
    const source = copiedWeek.id;
    let order = (after ?? weeks.length) + 1;
    startTransition(async () => {
      order = await pasteWeek(source, blockId, after);
      onSelect(order);
    });
    history.push({
      label: "paste week",
      undo: () => deleteWeek(blockId, order),
      redo: async () => {
        order = await pasteWeek(source, blockId, after);
      },
    });
  }

  function menuFor(e: React.MouseEvent, week: { id: string; order: number; locked: boolean }) {
    const w = week.order;
    weekMenu.open(e, [
      { label: t("Go to week {n}", { n: w }), onSelect: () => onSelect(w), disabled: w === active },
      "divider",
      {
        label: t("Copy week"),
        onSelect: () => setPref("clipboard", { kind: "week", id: week.id, label: `${phaseLabel} · ${t("Week {n}", { n: w })}` }),
      },
      {
        label: copiedWeek ? t("Paste “{name}” after this week", { name: copiedWeek.label }) : t("Paste week after this one"),
        onSelect: () => paste(w),
        disabled: !copiedWeek,
      },
      {
        label: t("Duplicate week"),
        onSelect: () => {
          let order = w + 1;
          startTransition(async () => {
            order = await pasteWeek(week.id, blockId, w);
            onSelect(order);
          });
          history.push({
            label: "duplicate week",
            undo: () => deleteWeek(blockId, order),
            redo: async () => {
              order = await pasteWeek(week.id, blockId, w);
            },
          });
        },
      },
      "divider",
      {
        label: week.locked ? t("Unlock week {n}", { n: w }) : t("Lock week {n}", { n: w }),
        onSelect: () => {
          const next = !week.locked;
          startTransition(() => {
            void setWeekLock(week.id, next);
          });
          history.push({
            label: next ? t("lock week {n}", { n: w }) : t("unlock week {n}", { n: w }),
            undo: () => setWeekLock(week.id, !next),
            redo: () => setWeekLock(week.id, next),
          });
        },
      },
      "divider",
      { label: t("Delete week {n}…", { n: w }), onSelect: () => setConfirmWeek(w), danger: true, disabled: weeks.length <= 1 },
    ]);
  }

  // Keep the open week in view when the strip is scrolled or a week is added at the end.
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>(`[data-week="${active}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, weeks.length]);

  return (
    <div
      style={{ maxWidth: SHELL_MAX_WIDTH }}
      className="mx-auto flex w-full items-center gap-3 border-b border-border bg-background px-4"
    >
      <div
        ref={strip}
        data-tour="weeks"
        // A mouse wheel only scrolls vertically; turn it sideways here.
        onWheel={(e) => {
          const el = strip.current;
          if (!el || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
          el.scrollLeft += e.deltaY;
        }}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
      {weeks.map(({ order: w, locked }) => (
        <div
          key={w}
          data-week={w}
          onContextMenu={(e) => menuFor(e, weeks.find((x) => x.order === w)!)}
          className={`group/tab flex shrink-0 items-center border-b-2 ${
            w === active ? "border-accent" : "border-transparent"
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(w)}
            className={`py-2 pl-3 text-[12px] ${
              w === active ? "font-medium text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {t("Week {n}", { n: w })}
          </button>
          {locked && (
            <span title={t("Week {n} is locked", { n: w })} className="pl-1 text-accent">
              <LockIcon locked size={11} />
            </span>
          )}
          {weeks.length > 1 && (
            <button
              ref={(el) => {
                if (w === confirmWeek) confirmAnchor.current = el;
              }}
              type="button"
              title={t("Delete week {n}", { n: w })}
              onClick={() => setConfirmWeek(w)}
              className={`px-1.5 py-2 text-[12px] text-muted-2 hover:text-accent focus-visible:opacity-100 ${
                confirmWeek === w ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100"
              }`}
            >
              ×
            </button>
          )}
        </div>
      ))}

      {confirmWeek !== null && weeks.length > 1 && (
        <Popover
          open
          onClose={() => setConfirmWeek(null)}
          anchorRef={confirmAnchor}
          width={220}
        >
          <Confirm
            key={confirmWeek}
            label="Delete this week"
            question={t("Delete week {n}?", { n: confirmWeek })}
            initiallyConfirming
            onConfirm={async () => {
              const target = confirmWeek;
              setConfirmWeek(null);
              onSelect(Math.max(1, target - 1));
              startTransition(() => {
                void deleteWeek(blockId, target);
              });
            }}
          />
        </Popover>
      )}
      <button
        type="button"
        onContextMenu={(e) =>
          weekMenu.open(e, [
            {
              label: copiedWeek ? t("Paste “{name}” at the end", { name: copiedWeek.label }) : t("Paste week at the end"),
              onSelect: () => paste(),
              disabled: !copiedWeek,
            },
          ])
        }
        onClick={() => {
          onAdded();
          startTransition(() => {
            void addWeek(blockId);
          });
        }}
        className="ml-2 shrink-0 whitespace-nowrap px-2 py-2 text-[12px] text-muted hover:text-accent"
      >
        + {t("add week")}
      </button>
      </div>

      <div data-tour="undo" className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => togglePref("tightIntensity")}
          title={
            tightIntensity
              ? t("Intensity sits beside reps — click to spread it across the week")
              : t("Keep intensity beside reps, notes take the extra width")
          }
          className={`grid size-8 place-items-center rounded-md border hover:border-accent hover:text-accent ${
            tightIntensity ? "border-accent/50 text-accent" : "border-border text-muted"
          }`}
        >
          <ColumnsIcon tight={tightIntensity} />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          disabled={history.undoLabel === null}
          onClick={history.undo}
          title={history.undoLabel ? `${t("Undo")} ${t(history.undoLabel)} (${keyLabel(primaryKey("undo") ?? "mod+z")})` : t("Nothing to undo")}
          className="grid size-8 place-items-center rounded-md border border-border text-muted hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted"
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          disabled={history.redoLabel === null}
          onClick={history.redo}
          title={history.redoLabel ? `${t("Redo")} ${t(history.redoLabel)} (${keyLabel(primaryKey("redo") ?? "mod+y")})` : t("Nothing to redo")}
          className="grid size-8 place-items-center rounded-md border border-border text-muted hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted"
        >
          <UndoIcon redo />
        </button>

        <button
          type="button"
          onClick={() =>
            startTransition(() => {
              void applyAllProgressions(blockId);
            })
          }
          title={t("Rewrite every later week from week 1 using each exercise's rules")}
          className="ml-1 h-8 rounded-md border border-border px-2.5 text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          {t("Apply progressions")}
        </button>
      </div>
      {weekMenu.menu}
    </div>
  );
}

function Header({
  template,
  week,
  startDate,
  block,
  athlete,
  weekId,
  locked,
  leftWidth,
  weekSpan,
}: {
  leftWidth: number;
  weekSpan: number;
  template: string;
  week: number;
  startDate: string;
  block: BlockData;
  athlete: AthleteData;
  weekId?: string;
  locked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const history = useHistory();
  const nameInput = "!w-auto min-w-[4ch] max-w-[48%] !px-1 !py-0.5 [field-sizing:content]";

  function rename(label: string, apply: (name: string) => Promise<unknown>, was: string, next: string) {
    void apply(next);
    history.push({ label, undo: () => apply(was), redo: () => apply(next) });
  }

  function lock(next: boolean) {
    if (!weekId) return;
    startTransition(() => {
      void setWeekLock(weekId, next);
    });
    history.push({
      label: next ? t("lock week {n}", { n: week }) : t("unlock week {n}", { n: week }),
      undo: () => setWeekLock(weekId, !next),
      redo: () => setWeekLock(weekId, next),
    });
  }

  return (
    <div
      className="sticky top-0 z-20 grid border-b border-border bg-background"
      style={{ gridTemplateColumns: template }}
    >
      <StickyCell left={0} width={leftWidth} span={4} className="flex items-center gap-1 px-3 py-1.5">
        <span data-tour="names" className="flex min-w-0 flex-1 items-center gap-1">
        {/* data-focus: where the palette's rename commands put the caret. */}
        <span data-focus="program-name" className="contents">
        <TextInput
          value={block.program.name}
          placeholder={t("Program")}
          className={`${nameInput} font-medium`}
          onCommit={(v) => {
            if (v === null) return;
            rename(
              "rename program",
              (name) => updateProgram(block.program.id, { name }),
              block.program.name,
              v,
            );
          }}
        />
        </span>
        <span className="text-[11px] text-muted-2">–</span>
        <span data-focus="phase-name" className="contents">
        <TextInput
          value={block.phase}
          placeholder={t("Phase")}
          className={`${nameInput} text-muted`}
          onCommit={(v) => {
            if (v === null) return;
            rename("rename phase", (phase) => updateBlock(block.id, { phase }), block.phase, v);
          }}
        />
        </span>
        </span>
        {weekId && (
          <button
            type="button"
            data-tour="lock"
            disabled={pending}
            onClick={() => lock(!locked)}
            title={
              locked
                ? t("Week {n} is locked — progressions skip it. Click to unlock.", { n: week })
                : t("Lock week {n} so progressions leave it alone", { n: week })
            }
            className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-surface-3 disabled:opacity-60 ${
              locked ? "text-accent" : "text-muted-2 hover:text-foreground"
            }`}
          >
            <LockIcon locked={locked} size={12} />
            {locked ? t("Locked") : t("Lock week")}
          </button>
        )}
      </StickyCell>
      <div
        className="flex items-center gap-2 border-r border-l border-border px-3 py-1.5"
        style={{ gridColumn: `span ${weekSpan}` }}
      >
        <span className="text-[12px] font-semibold">{t("Week {n}", { n: week })}</span>
        <span className="text-[11px] text-muted-2">{weekDate(startDate, week)}</span>

        <div
          data-tour="maxes"
          className="ml-auto flex items-center gap-1"
          title={t("This phase's 1RMs — every target weight comes off these. Other phases keep their own.")}
        >
          <span className="mr-1 text-[11px] tracking-[0.14em] text-muted-2">1RM</span>
          {MAX_FIELDS.map(({ key, label }) => (
            <label key={key} data-focus={`max-${key}`} className="flex items-center rounded border border-border pl-1.5">
              <span className="text-[11px] text-muted-2">{label}</span>
              <NumberInput
                value={block[key]}
                placeholder={athlete[key] === null ? "—" : String(athlete[key])}
                className="!w-[54px] !py-0.5 font-medium"
                onCommit={(v) => {
                  const was = block[key];
                  void updateBlockMaxes(block.id, { [key]: v });
                  history.push({
                    label: `${label} 1RM`,
                    undo: () => updateBlockMaxes(block.id, { [key]: was }),
                    redo: () => updateBlockMaxes(block.id, { [key]: v }),
                  });
                }}
              />
            </label>
          ))}
          <span className="text-[11px] text-muted-2">{athlete.unit === "LB" ? "lb" : "kg"}</span>
        </div>
      </div>
    </div>
  );
}

const MAX_FIELDS = [
  { key: "squat1RM", label: "SQ" },
  { key: "bench1RM", label: "BP" },
  { key: "dead1RM", label: "DL" },
] as const;

/** A curved arrow back (or, mirrored, forward) — the usual undo/redo glyph. */
function UndoIcon({ redo = false }: { redo?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-4 ${redo ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 3.5 2.5 6.5l3 3" />
      <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
    </svg>
  );
}

/** Four columns, the third either stretched wide or held narrow. */
function ColumnsIcon({ tight }: { tight: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      {tight ? (
        <path d="M4 3v10M6.5 3v10M9.5 3v10" />
      ) : (
        <path d="M3.5 3v10M5.5 3v10M11 3v10" />
      )}
    </svg>
  );
}

export function LockIcon({ locked, size }: { locked: boolean; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d={locked ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.5-2"} />
    </svg>
  );
}

/**
 * With rest days hidden, the week at a glance: every day as a chip. A training day
 * scrolls to its session; a rest day becomes a training day on click.
 */
function DayStrip({
  days,
  startDate,
  onTrain,
}: {
  days: DayData[];
  startDate: string;
  onTrain: (day: DayData) => void;
}) {
  return (
    <div className="sticky left-0 flex w-fit flex-wrap items-center gap-1 px-4 pt-3">
      {days.map((day) => {
        const weekday = weekdayShort(weekdayOfDay(startDate, day.index));
        return (
          <button
            key={day.id}
            type="button"
            title={
              day.rest
                ? t("{day} is a rest day — click to train on it", { day: t(WEEKDAYS[weekdayOfDay(startDate, day.index)]) })
                : t("Go to {name}", { name: day.label })
            }
            onClick={() =>
              day.rest
                ? onTrain(day)
                : document.getElementById(`day-${day.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" })
            }
            className={`flex min-w-[64px] flex-col items-start rounded-md border px-2 py-1 text-left ${
              day.rest
                ? "border-dashed border-border text-muted-2 hover:border-accent hover:text-accent"
                : "border-border bg-surface text-foreground hover:border-accent/60"
            }`}
          >
            <span className="text-[10px] tracking-[0.12em] uppercase">{weekday}</span>
            <span className="max-w-[110px] truncate text-[11px]">{day.rest ? `+ ${dayName(day)}` : day.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SubHeader({ cols }: { cols: WeekCol[] }) {
  return (
    <>
      {cols.map((col, k) => (
        <HeadCell
          key={col}
          className={`${col === "intensity" ? "justify-end" : col === "notes" || col === "video" ? "!justify-start" : ""} ${
            k === cols.length - 1 ? "border-r border-border" : ""
          }`}
        >
          {t(WEEK_COL_LABEL[col])}
        </HeadCell>
      ))}
    </>
  );
}

function HeadCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-center justify-center px-2 py-2 ${className}`}>{children}</div>;
}

function GridCell({
  children,
  className = "",
  nav,
  tour,
}: {
  children: React.ReactNode;
  className?: string;
  nav?: string;
  tour?: string;
}) {
  return (
    <div data-nav={nav} data-tour={tour} className={`flex items-center ${className}`}>
      {children}
    </div>
  );
}

function StickyCell({
  children,
  left,
  width,
  span = 1,
  className = "",
  nav,
  tour,
  tinted = false,
}: {
  children?: React.ReactNode;
  left: number;
  width: number;
  span?: number;
  className?: string;
  nav?: string;
  tour?: string;
  /** Carries its row's --tint, over an opaque ground so the sheet can scroll beneath it. */
  tinted?: boolean;
}) {
  return (
    <div
      data-nav={nav}
      data-tour={tour}
      className={`sticky z-10 ${tinted ? "bg-[color-mix(in_srgb,var(--tint)_9%,var(--surface))]" : "bg-surface"} ${className}`}
      style={{ left, width, gridColumn: `span ${span}` }}
    >
      {children}
    </div>
  );
}
