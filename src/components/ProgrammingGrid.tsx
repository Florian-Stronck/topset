"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { flushSync } from "react-dom";
import type { IntensityType, Tier } from "@prisma/client";
import {
  addRow,
  addWeek,
  fillForward,
  fillMeetDay,
  fillWeekForward,
  undoFill,
  unfillMeetDay,
  swapDays,
  deleteRow,
  deleteWeek,
  pasteWeek,
  restoreRow,
  restoreWeek,
  duplicateRow,
  insertRow,
  moveRow,
  moveRowsTo,
  pasteRows,
  placeRows,
  setWeekLock,
  updateBlock,
  updateBlockMaxes,
  updateCell,
  updateDay,
  updateProgram,
  updateRow,
  type FillResult,
  type LoggedRow,
  type RowTemplate,
} from "@/app/programming/actions";
import { inputBase, NumberInput, TextInput } from "@/components/cells";
import { MenuOptions } from "@/components/Select";
import { Popover } from "@/components/Popover";
import { Confirm } from "@/components/Confirm";
import { ExerciseInput } from "@/components/ExerciseInput";
import { useHistory, type History } from "@/components/history";
import { useSettings } from "@/components/SettingsProvider";
import { IntensityAmount, IntensityKind, parseKind } from "@/components/IntensityEditor";
import { ProgressionRules } from "@/components/ProgressionRules";
import { meetOn, type MeetSummary } from "@/lib/competition";
import { classifyExercise, isBackoff, resolveAlias } from "@/lib/exercises";
import { maxesOf, parseIntensity, resolveDay } from "@/lib/intensity";
import { dayName } from "@/lib/days";
import { formatDuration, parseDuration } from "@/lib/duration";
import { parseReps, repsText } from "@/lib/reps";
import { formatDate, today as calendarToday, weekdayOf, weekdayOfDay, ymdOf } from "@/lib/dates";
import { weekOn } from "@/lib/schedule";
import { GRID_MIN_WIDTH, SHELL_MAX_WIDTH } from "@/lib/layout";
import { colorOfTarget, getPref, resetPref, setPref, tierShade, usePref, togglePref, type Column } from "@/lib/prefs";
import { activeSettings, TIERS, tierLabel } from "@/lib/settings";
import { claimsKey } from "@/components/CommandCenter";
import { useCommands, type Command } from "@/lib/commands";
import { COMMAND_SPECS, label as keyLabel, primaryKey } from "@/lib/shortcuts";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import {
  WEEKDAYS,
  type AthleteData,
  type BlockData,
  type Prescription,
  type DayData,
  type RowData,
} from "@/lib/types";
import { t, weekdayShort } from "@/lib/i18n";
import { tutorialDid } from "@/components/Tutorial";

/** The week's columns in the order they sit, left to right. */
type WeekCol = "sets" | "reps" | "time" | "kind" | "intensity" | "load" | "tempo" | "rest" | "video" | "notes";

const WEEK_COL_LABEL: Record<WeekCol, string> = {
  sets: "SETS",
  reps: "REPS",
  time: "TIME",
  kind: "TYPE",
  intensity: "INTENSITY",
  load: "WEIGHT",
  tempo: "TEMPO",
  rest: "REST",
  video: "VIDEO",
  notes: "COACH NOTES",
};

/** The columns a coach can switch off, as the Columns menu names them. */
const COLUMN_NAMES: [Column, string][] = [
  ["progression", "PROGRESSION"],
  ["time", "TIME"],
  ["weight", "WEIGHT"],
  ["tempo", "TEMPO"],
  ["rest", "REST"],
  ["video", "VIDEO"],
  ["notes", "COACH NOTES"],
];

/** Where find and replace can look: the text a coach writes, by the column it is in. */
const FIND_FIELDS = [
  ["exercise", "EXERCISE"],
  ["target", "TARGET"],
  ["coachNotes", "COACH NOTES"],
] as const;
type FindField = (typeof FIND_FIELDS)[number][0];
/** What a find looks through: which columns, and this week or every week of the phase. */
type FindIn = { fields: FindField[]; scope: "week" | "phase" };

/** The prescription field a text column edits. */
const TEXT_FIELD = { notes: "coachNotes", tempo: "tempo", rest: "restTime", video: "videoUrl" } as const;

/** A keyboard column: the row's own two, then the week's. */
type NavKey = "target" | "exercise" | "progression" | WeekCol;

/** What copying a column carries. TARGET brings the tier badge that sits in its cell. */
const COL_FIELDS: Record<NavKey, readonly (keyof RowTemplate)[]> = {
  target: ["target", "tier"],
  exercise: ["exercise"],
  progression: ["rules"],
  sets: ["sets"],
  reps: ["reps", "repsMax"],
  time: ["duration"],
  kind: ["intensityType", "rampStep"],
  intensity: ["intensity", "intensityMax"],
  load: ["load"],
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
/** A day picked up from its menu — outlives the grid, so it pastes into another athlete or phase. */
type DayClip = { id: string; label: string; move: boolean; dayLabel: string; rows: RowTemplate[] };
let dayClipStore: DayClip | null = null;
const dayClipListeners = new Set<() => void>();
function setDayClip(clip: DayClip | null) {
  dayClipStore = clip;
  dayClipListeners.forEach((l) => l());
}
function subscribeDayClip(l: () => void) {
  dayClipListeners.add(l);
  return () => void dayClipListeners.delete(l);
}

/**
 * The grid's columns for the coach's view settings. The left four are sticky and fixed
 * (PROGRESSION shrinks to nothing when hidden, so the offsets never move); the week
 * absorbs a wide display — INTENSITY a little and COACH NOTES most of it, or all of it
 * in notes when intensity is kept beside reps. A width the coach dragged a column to
 * (`widths`, by column key) replaces its own.
 */
function gridLayout(
  columns: Record<Column, boolean>,
  tight: boolean,
  timed: boolean,
  autoExW: number,
  widths: Record<string, number>,
) {
  // TIME shows when switched on, or on its own once any row of the phase is timed.
  const cols: WeekCol[] = ["sets", "reps", ...(columns.time || timed ? (["time"] as const) : []), "kind", "intensity"];
  if (columns.weight) cols.push("load");
  if (columns.tempo) cols.push("tempo");
  if (columns.rest) cols.push("rest");
  if (columns.video) cols.push("video");
  if (columns.notes) cols.push("notes");

  const width: Record<WeekCol, string> = {
    sets: "56px",
    reps: "56px",
    time: "64px",
    // The kind and the number are cells of their own, so each fills down without the other.
    kind: "56px",
    intensity: "72px",
    // The weight it all comes to, or a ramp ("90→100 kg").
    load: tight || !columns.notes ? "112px" : "minmax(112px,1fr)",
    tempo: "76px",
    rest: "76px",
    video: "140px",
    notes: tight ? "minmax(202px,1fr)" : "minmax(236px,2fr)",
  };
  if (!columns.notes && !tight) width.intensity = "minmax(144px,1fr)";
  for (const c of cols) if (widths[c]) width[c] = `${widths[c]}px`;

  const targetW = widths.target ?? 128;
  const exW = widths.exercise ?? autoExW;
  const exLeft = 40 + targetW;
  const progression = columns.progression ? (widths.progression ?? 164) : 0;
  return {
    cols,
    showProgression: columns.progression,
    leftWidth: exLeft + exW + progression,
    /** TARGET's width; EXERCISE's, where it starts, and where the column after it starts. */
    targetW,
    exW,
    exLeft,
    progLeft: exLeft + exW,
    template: `40px ${targetW}px ${exW}px ${progression}px ${cols.map((c) => width[c]).join(" ")}`,
    /** Keyboard columns: target, exercise, PROGRESSION when it shows, then the week's. */
    navKeys: ["target", "exercise", ...(columns.progression ? (["progression"] as const) : []), ...cols] as NavKey[],
    /** The keyboard column the week's first cell is. */
    weekStart: columns.progression ? 3 : 2,
  };
}


type FillField = NonNullable<Parameters<typeof fillForward>[1]>[number];

/** The row fields each column holds, for filling it into later weeks. */
const FILL_FIELDS: Record<NavKey, FillField[]> = {
  target: ["target"],
  exercise: ["exercise", "tier"],
  progression: [],
  sets: ["sets"],
  reps: ["reps", "repsMax"],
  time: ["duration"],
  kind: ["intensityType", "rampStep"],
  // A number means nothing without its kind, so the kind always comes along.
  intensity: ["intensityType", "intensity", "intensityMax"],
  load: ["load"],
  tempo: ["tempo"],
  rest: ["restTime"],
  video: ["videoUrl"],
  notes: ["coachNotes"],
};

/**
 * What text typed or pasted into a column means for its row, read the way a sheet's cell
 * would hold it: "3x5" in SETS or REPS is both, "80%" or "@8" in INTENSITY brings its kind,
 * a weight may carry its unit. Null when the column can't take the text.
 */
function parseCell(col: NavKey, text: string, kind: IntensityType): Partial<RowTemplate> | null {
  const s = text.trim();
  if (col === "target") return { target: s || "General" };
  if (col === "exercise") return { exercise: s };
  if (col === "progression") return null;
  if (col === "kind") {
    // A kind is only ever replaced, never cleared.
    if (s === "") return {};
    const parsed = parseKind(s);
    return parsed ? { intensityType: parsed } : null;
  }
  if (col === "notes" || col === "tempo" || col === "rest" || col === "video") {
    return { [TEXT_FIELD[col]]: s || null } as Partial<RowTemplate>;
  }
  if (col === "sets" || col === "reps") {
    const both = /^(\d{1,2})\s*[x×*]\s*(.+)$/i.exec(s);
    if (both) {
      const reps = parseReps(both[2]);
      return reps && reps.reps !== null ? { sets: Number(both[1]), ...reps } : null;
    }
    if (col === "reps") return parseReps(s);
  }
  if (col === "time") {
    const duration = parseDuration(s);
    return duration === null && s !== "" ? null : { duration };
  }
  if (col === "intensity") return parseIntensity(s, kind);
  if (s === "") return { [col]: null };
  const n = /^(-?\d+(?:[.,]\d+)?)\s*(?:kg|lbs?)?$/i.exec(s);
  return n ? { [col]: Number(n[1].replace(",", ".")) } : null;
}

/** One cell to write: its slot, column and text — and, for a fill, the row it is filled from. */
type CellWrite = { r: number; c: number; text: string; from?: number };

/** A row to write, by its id, and all that goes on it. */
type Templated = { id: string; template: RowTemplate };

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

/** A block of cells, by its corners. */
type Box = { r1: number; r2: number; c1: number; c2: number };

function rectOf(a: Coord, b: Coord): Box {
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

/** The grid's palette commands for an athlete shared to view or review: none. */
const NO_COMMANDS: Command[] = [];

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
  readOnly = false,
  pausedBy,
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
  /** Shared with this coach to view or review: the weeks switch, nothing else moves. */
  readOnly?: boolean;
  /** The program trained on a date instead of this one, where they overlap. */
  pausedBy?: (ymd: string) => string | null;
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
  /** A day picked up from its menu, waiting to be copied or moved onto another. */
  const dayClip = useSyncExternalStore(subscribeDayClip, () => dayClipStore, () => null);
  const pickDay = (day: DayData, label: string, move: boolean) =>
    setDayClip({ id: day.id, label, move, dayLabel: day.label, rows: day.rows.filter((r) => !isBlank(r)).map(rowTemplate) });

  /** Saves on their way to the server, for the "Saving…" in the status line. */
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  function track<T>(work: Promise<T>): Promise<T> {
    setSaving((n) => n + 1);
    return work.finally(() => {
      setSaving((n) => n - 1);
      setSaved(true);
    });
  }

  /** A line in the status bar that goes away by itself: what a paste could not read, say. */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function notify(text: string) {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }

  /** Runs an edit and records how to take it back. `at` is a row it touched, for undo to scroll to. */
  function edit(label: string, run: () => Promise<unknown>, undo: () => Promise<unknown>, key?: string, at?: string) {
    history.push({ label, undo: () => track(undo()), redo: () => track(run()), key, at });
    startTransition(() => {
      void track(run());
    });
  }

  /** The block last copied, framed until the next edit or Escape — and the week it is in. */
  const [copied, setCopied] = useState<{ week: number; box: Box } | null>(null);
  /** Find and replace: whether its bar is up, and the cell the last "next" landed on. */
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<Coord | null>(null);
  /** The column a run of Tabs started in: Enter comes back to it on the next row. */
  const tabCol = useRef<number | null>(null);

  /** The row whose × has had one click: the second deletes it. */
  const [armed, setArmed] = useState<string | null>(null);

  /** Counts focus moves in the grid: a cell's saves while it keeps the focus are one undo step. */
  const focusSession = useRef(0);

  /** Copies or moves the picked-up day onto `target`. A copy adds its rows after any there. */
  function dropDay(target: DayData) {
    const source = dayClip;
    if (!source) return;
    setDayClip(null);
    if (source.move) {
      edit("move day", () => swapDays(source.id, target.id), () => swapDays(source.id, target.id));
      return;
    }
    const create = source.rows.map((template) => ({ id: crypto.randomUUID(), template }));
    // An empty or rest day takes the copied day's name too.
    const takeName = target.rest || target.rows.every(isBlank);
    edit(
      "copy day",
      async () => {
        if (takeName) await updateDay(target.id, { label: source.dayLabel, rest: false });
        await pasteRows(target.id, { create });
      },
      async () => {
        await pasteRows(target.id, { remove: create.map((c) => c.id) });
        if (takeName) await updateDay(target.id, { label: target.label, rest: target.rest });
      },
    );
  }

  // Local edits are optimistic; adopt the server copy whenever a revalidation lands.
  if (synced !== initialBlock) {
    setSynced(initialBlock);
    setBlock(initialBlock);
  }

  const activeWeek = Math.min(week, block.weeks.length);
  /** No week after this one to fill into. */
  const lastWeek = activeWeek >= block.weeks.length;
  const weeks = [activeWeek];
  const maxes = maxesOf(block, athlete);

  // The grid shows one week, and that week owns its days outright.
  const activeWeekData = block.weeks.find((w) => w.order === activeWeek);
  const days = useMemo(() => activeWeekData?.days ?? [], [activeWeekData]);
  // The tutorial points at the first real session on screen — in a program still empty, the
  // first training day, or failing that the first day.
  const tourDayId = (
    days.find((d) => !d.rest && d.rows.some((r) => r.exercise.trim())) ??
    days.find((d) => !d.rest) ??
    days[0]
  )?.id;

  // The week and day being trained today, and the day to open on: today, else the next one.
  const todayYmd = ymdOf(calendarToday());
  const nowWeek = weekOn(block.startDate, block.weeks.length, todayYmd);
  const openDayId = nowWeek === activeWeek ? days.find((d) => dayYmd(block.startDate, activeWeek, d.index) >= todayYmd)?.id : undefined;
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !openDayId) return;
    opened.current = true;
    document.getElementById(`day-${openDayId}`)?.scrollIntoView({ block: "start" });
  }, [openDayId]);

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
  const hideRestDays = usePref("hideRestDays");
  const { tiers, targets } = useSettings().settings;
  const timed = useMemo(() => block.weeks.some((w) => w.days.some((d) => d.rows.some((r) => r.duration !== null))), [block]);
  // EXERCISE is as wide as the week's longest name, within reason, so none is cut short.
  const exW = useMemo(() => {
    const longest = Math.max(0, ...days.flatMap((d) => d.rows.map((r) => r.exercise.length)));
    return Math.min(300, Math.max(168, longest * 7 + 24));
  }, [days]);
  const columnWidths = usePref("columnWidths");
  const wrapNotes = usePref("wrapNotes");
  const layout = useMemo(
    () => gridLayout(columns, tightIntensity, timed, exW, columnWidths),
    [columns, tightIntensity, timed, exW, columnWidths],
  );
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
  /** A drag of the fill handle: the block it started from, and the row it has reached. */
  const fillFrom = useRef<Box | null>(null);
  const [fillTo, setFillTo] = useState<number | null>(null);
  const fillHandle = useRef<HTMLDivElement>(null);
  /** The frames round the selection and round what was copied. */
  const selFrame = useRef<HTMLDivElement>(null);
  const copyFrame = useRef<HTMLDivElement>(null);
  // Painted on the DOM rather than threaded through six cell call sites, the same way
  // the rest of this grid reaches cells by their nav coordinates. Run again on a sideways
  // scroll too: the sticky columns move under the frames without a render.
  const paint = useRef(() => {});
  useEffect(() => {
  paint.current = () => {
    const root = gridRef.current;
    if (!root) return;
    // A cell's whole box — TARGET's holds its tier badge beside the text that is its nav cell.
    const cellAt = (r: number, c: number) => {
      const el = root.querySelector<HTMLElement>(`[data-nav="${r}-${c}"]`);
      return el?.closest<HTMLElement>('[role="gridcell"]') ?? el;
    };
    for (const el of root.querySelectorAll<HTMLElement>("[data-nav]")) {
      const [r, c] = el.dataset.nav!.split("-").map(Number);
      el.classList.toggle("bg-accent-soft", found !== null && found[0] === r && found[1] === c);
    }
    const g = root.getBoundingClientRect();
    /** Lays a frame round a block of cells — whole rows edge to edge — or puts it away. */
    const frame = (el: HTMLElement | null, box: Box | null) => {
      if (!el) return;
      const whole = box !== null && box.c1 === 0 && box.c2 === NAV_COLS - 1;
      const first = box && (whole ? root.querySelector<HTMLElement>(`[data-slot="${box.r1}"]`) : cellAt(box.r1, box.c1));
      const last = box && (whole ? root.querySelector<HTMLElement>(`[data-slot="${box.r2}"]`) : cellAt(box.r2, box.c2));
      const a = first?.getBoundingClientRect();
      const b = last?.getBoundingClientRect();
      el.classList.toggle("hidden", !a || !b);
      if (!a || !b) return;
      el.style.left = `${a.left - g.left}px`;
      el.style.top = `${a.top - g.top}px`;
      el.style.width = `${b.right - a.left}px`;
      el.style.height = `${b.bottom - a.top}px`;
    };
    // The selection, stretched over the rows a fill handle has been dragged across.
    const shown =
      rect && fillTo !== null ? { ...rect, r1: Math.min(rect.r1, fillTo), r2: Math.max(rect.r2, fillTo) } : rect;
    frame(selFrame.current, spans || fillTo !== null ? shown : null);
    frame(copyFrame.current, copied?.week === activeWeek ? copied.box : null);
    // The active cell keeps its own focus ring only while it is the whole selection.
    root.toggleAttribute("data-range", spans);
    // The fill handle sits on the corner of the selection, or of where a fill has dragged it.
    const handle = fillHandle.current;
    if (handle) {
      // Whole rows move by their grip and copy whole: no fill handle on them.
      const corner = shown && !readOnly && !wholeRows ? cellAt(shown.r2, shown.c2) : null;
      handle.classList.toggle("hidden", !corner);
      if (corner) {
        const b = corner.getBoundingClientRect();
        handle.style.left = `${b.right - g.left - 5}px`;
        handle.style.top = `${b.bottom - g.top - 5}px`;
      }
    }
    // The row numbers and column names of the selection light up, as a sheet's headers do.
    for (const el of root.querySelectorAll<HTMLElement>("[data-row-head]")) {
      const r = Number(el.dataset.rowHead);
      el.classList.toggle("text-accent", rect !== null && r >= rect.r1 && r <= rect.r2);
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-col-head]")) {
      const c = Number(el.dataset.colHead);
      el.classList.toggle("text-accent", rect !== null && c >= rect.c1 && c <= rect.c2);
    }
  };
  paint.current();
  });

  useEffect(() => {
    function stop() {
      latestEndDrag.current();
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
    tabCol.current = null;
    // A right-click inside the selection keeps it: its menu is about those cells.
    if (e.button === 2 && rect && spans && at[0] >= rect.r1 && at[0] <= rect.r2 && at[1] >= rect.c1 && at[1] <= rect.c2) return;
    if (e.shiftKey && sel) {
      e.preventDefault();
      setSel({ a: sel.a, b: at });
      return;
    }
    // A click selects the cell, as in a sheet: the text is not to be dragged across or
    // put a caret in until a double-click or F2 starts editing it.
    // Anywhere in the cell counts — its padding, TARGET's badge column — but a button is its own.
    const el = e.target as HTMLElement;
    const input =
      el instanceof HTMLInputElement
        ? el
        : !el.closest("button")
          ? (el.closest<HTMLElement>("[data-nav]")?.querySelector("input") ?? null)
          : null;
    if (input && !("editing" in input.dataset) && e.button === 0) {
      e.preventDefault();
      input.focus();
      input.select();
    }
    // Not a selection yet — a drag only becomes one once it reaches another cell, so
    // click-dragging inside a cell being edited still selects its text.
    anchor.current = at;
    setSel({ a: at, b: at });
  }

  /** Repeats a block of cells over the rows from its edge to `to` — below it, or above. */
  function fillRows(box: Box, to: number) {
    if (to >= box.r1 && to <= box.r2) return;
    const height = box.r2 - box.r1 + 1;
    const [lo, hi] = to > box.r2 ? [box.r2 + 1, to] : [to, box.r1 - 1];
    const writes: CellWrite[] = [];
    for (let r = lo; r <= hi; r++) {
      const from = box.r1 + ((((r - box.r1) % height) + height) % height);
      for (let c = box.c1; c <= box.c2; c++) writes.push({ r, c, text: readCell(from, c), from });
    }
    writeCells("fill down", writes);
    setSel({ a: [Math.min(box.r1, to), box.c1], b: [Math.max(box.r2, to), box.c2] });
  }

  /** Ends a drag of the fill handle: the block it started from goes over the rows it reached. */
  function endFill() {
    const box = fillFrom.current;
    fillFrom.current = null;
    if (!box) return;
    setFillTo(null);
    if (fillTo !== null) fillRows(box, fillTo);
  }
  const latestEndDrag = useRef(endFill);
  useEffect(() => {
    latestEndDrag.current = endFill;
  });

  function onFillHandleDown(e: React.MouseEvent) {
    if (!rect || e.button !== 0) return;
    // Not the grid's: a drag from here fills rather than selects, and the focus stays put.
    e.preventDefault();
    e.stopPropagation();
    fillFrom.current = rect;
    setFillTo(rect.r2);
    setDragging(true);
  }

  /** A double-click on the fill handle fills to the end of the day, as a sheet fills to the end of its data. */
  function onFillHandleDouble(e: React.MouseEvent) {
    e.stopPropagation();
    if (!rect) return;
    const day = nav.slots.get(rect.r2)?.day.id;
    let to = rect.r2;
    while (nav.slots.get(to + 1)?.row && nav.slots.get(to + 1)?.day.id === day) to++;
    fillRows(rect, to);
  }

  /** A drag held near the top or bottom edge scrolls the sheet along with it. */
  function onGridMouseMove(e: React.MouseEvent) {
    if (e.buttons !== 1 || !(anchor.current || rowAnchor.current !== null || fillFrom.current)) return;
    const scroller = gridRef.current?.parentElement;
    if (!scroller) return;
    const edge = scroller.getBoundingClientRect();
    // ponytail: scrolls only while the mouse moves; a timer if holding still at the edge matters.
    if (e.clientY > edge.bottom - 40) scroller.scrollTop += 18;
    else if (e.clientY < edge.top + 90) scroller.scrollTop -= 18;
  }

  function onGridMouseOver(e: React.MouseEvent) {
    const box = fillFrom.current;
    if (box && e.buttons === 1) {
      const at = coordOf(e.target);
      if (at) setFillTo(at[0]);
      return;
    }
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

  /** Puts a selected cell into editing, caret at the end, as a double-click or F2 does in a sheet. */
  function startEditing(input: HTMLInputElement) {
    input.dataset.editing = "";
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  function onGridDoubleClick(e: React.MouseEvent) {
    const input = e.target instanceof HTMLInputElement ? e.target : null;
    if (input && !input.readOnly && coordOf(input)) startEditing(input);
  }

  /**
   * What a cell holds right now, read off the DOM so it includes uncommitted typing. With
   * `shown`, what it reads as on screen instead: both ends of a range, and a weight that
   * is only worked out — for copying out, where a blank would be a lie.
   */
  function readCell(r: number, c: number, shown = false) {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-nav="${r}-${c}"]`);
    if (navKeys[c] === "progression") {
      return [...(el?.querySelectorAll("[data-rule]") ?? [])].map((s) => s.textContent).join(", ");
    }
    const inputs = [...(el?.querySelectorAll("input") ?? [])];
    if (inputs.length === 0) return (el?.textContent ?? "").trim();
    if (!shown) return inputs[0].value.trim();
    const text = inputs.map((i) => i.value.trim()).filter(Boolean).join("-");
    const hint = inputs[0].placeholder;
    return text || (navKeys[c] === "load" && hint !== "—" ? hint : "");
  }

  /**
   * Writes a block of cells as one undoable edit. TARGET and EXERCISE belong to the row
   * itself; the rest are PROGRESSION (skipped) and this week's prescription. Text a
   * column can't take is left out, and said so.
   */
  function writeCells(label: string, writes: CellWrite[]) {
    type Patch = { next: Record<string, unknown>; prev: Record<string, unknown> };
    const rowPatches = new Map<string, Patch>();
    const cellPatches = new Map<string, Patch>();
    let dropped = 0;

    for (const { r, c, text, from } of writes) {
      const row = nav.slots.get(r)?.row;
      const col = navKeys[c];
      // Rules only travel with copied rows; typed or cleared text can't make one.
      if (!row || col === undefined || col === "progression") continue;

      const map = col === "target" || col === "exercise" ? rowPatches : cellPatches;
      const entry = map.get(row.id) ?? { next: {}, prev: {} };
      // A kind written earlier in the same block is the one a bare number is read against.
      const kind = (cellPatches.get(row.id)?.next.intensityType as IntensityType | undefined) ?? row.intensityType;
      const parsed: Record<string, unknown> | null = parseCell(col, text, kind);
      if (!parsed) {
        dropped++;
        continue;
      }

      const source = from === undefined ? undefined : nav.slots.get(from)?.row;
      // Filled from a row, a kind brings its ramp.
      if (source && col === "kind" && parsed.intensityType) parsed.rampStep = source.rampStep;
      // And intensity a range's top — its kind is the next cell over and stays. The top is
      // read off the DOM like the number, so one just typed and not yet in state comes along.
      if (source && col === "intensity") {
        const max = gridRef.current
          ?.querySelectorAll<HTMLInputElement>(`[data-nav="${from}-${c}"] input`)[1]
          ?.value.trim();
        parsed.intensityMax =
          max === undefined ? source.intensityMax : max === "" ? null : Number(max.replace(",", "."));
      }

      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in entry.prev)) entry.prev[key] = (row as unknown as Record<string, unknown>)[key] ?? null;
        entry.next[key] = value;
      }
      if (Object.keys(entry.next).length > 0) map.set(row.id, entry);
    }

    if (dropped > 0) notify(t("{n} cells could not take what was put in them", { n: dropped }));
    if (rowPatches.size === 0 && cellPatches.size === 0) return;
    setCopied(null);

    const apply = (pick: "next" | "prev") => {
      setBlock((b) =>
        mapRows(b, (r) => {
          const rowPatch = rowPatches.get(r.id)?.[pick];
          const cellPatch = cellPatches.get(r.id)?.[pick];
          return rowPatch || cellPatch ? ({ ...r, ...rowPatch, ...cellPatch } as RowData) : r;
        }),
      );

      return track(
        Promise.all([
          ...[...rowPatches].map(([id, p]) => updateRow(id, p[pick] as Parameters<typeof updateRow>[1])),
          ...[...cellPatches].map(([id, p]) => updateCell(id, p[pick] as Partial<Prescription>)),
        ]),
      );
    };

    void apply("next");
    const at = [...rowPatches.keys(), ...cellPatches.keys()][0];
    history.push({ label, undo: () => apply("prev"), redo: () => apply("next"), at });
  }

  /**
   * Copies a block of cells: as tab-separated text for other programs, and as the rows
   * themselves for pasting back in here. Returns the text.
   */
  function copyCells(box: Box): string {
    const lines: string[] = [];
    const rows: RowTemplate[] = [];
    const whole = box.c1 === 0 && box.c2 === NAV_COLS - 1;
    for (let r = box.r1; r <= box.r2; r++) {
      const row = nav.slots.get(r)?.row;
      // Whole rows leave out the unnamed ones: a day only ever has one, at its end.
      if (!row || (whole && isBlank(row))) continue;
      const cols: string[] = [];
      for (let c = box.c1; c <= box.c2; c++) cols.push(readCell(r, c, true));
      lines.push(cols.join("\t"));
      rows.push(rowTemplate(row));
    }
    const text = lines.join("\n");
    if (rows.length > 0) {
      setClipboard({ rows, cols: whole ? null : (navKeys.slice(box.c1, box.c2 + 1) as NavKey[]), text });
      setCopied({ week: activeWeek, box });
    }
    return text;
  }

  /** Whether a clipboard event is this grid's: the focus is somewhere inside it. */
  function ours() {
    return gridRef.current?.contains(document.activeElement) ?? false;
  }

  /** A cell with no text field (the intensity's kind): the browser has nothing there to copy or paste into. */
  function buttonCell() {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? null : coordOf(el);
  }

  function onGridCopy(e: ClipboardEvent) {
    if (!ours() || !e.clipboardData) return;
    const one = spans ? null : buttonCell();
    const box = spans ? rect : one && { r1: one[0], r2: one[0], c1: one[1], c2: one[1] };
    if (!box) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", copyCells(box));
  }

  /** The rows of a block that are really there, for deleting them. */
  function rowsIn(box: Box) {
    const picked: { row: RowData; dayId: string }[] = [];
    for (let r = box.r1; r <= box.r2; r++) {
      const slot = nav.slots.get(r);
      if (slot?.row && !isBlank(slot.row)) picked.push({ row: slot.row, dayId: slot.day.id });
    }
    return picked;
  }

  /** Empties a block of cells — or, when it is whole rows, takes the rows out. */
  function clearBox(box: Box, label: string) {
    if (box.c1 === 0 && box.c2 === NAV_COLS - 1) {
      setSel(null);
      deleteRows(rowsIn(box));
      return;
    }
    const writes: CellWrite[] = [];
    for (let r = box.r1; r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) writes.push({ r, c, text: "" });
    writeCells(label, writes);
  }

  /** A cut of a block copies it and then empties its cells; one cell's text is the browser's. */
  function onGridCut(e: ClipboardEvent) {
    if (!ours() || !e.clipboardData || !spans || !rect) return;
    onGridCopy(e);
    clearBox(rect, "cut");
  }

  function onGridPaste(e: ClipboardEvent) {
    if (!ours() || !e.clipboardData) return;
    const text = e.clipboardData.getData("text/plain");
    // A single value into one cell is the browser's business — ours is a grid of values,
    // one value onto a selected block, or a cell the browser has nowhere to paste into.
    const one = buttonCell();
    const block = spans && !editingText(document.activeElement);
    if (!text || (!/[\t\n]/.test(text) && !one && !block)) return;

    const start = spans && rect ? ([rect.r1, rect.c1] as Coord) : (one ?? (rect ? ([rect.r1, rect.c1] as Coord) : coordOf(document.activeElement)));
    if (!start) return;
    e.preventDefault();
    pasteText(text, start);
  }

  /**
   * Pastes clipboard text at a cell. Rows copied out of this grid come back whole; one
   * value fills the selection; a grid of values — a block out of a sheet — is written
   * down the day from there, making the rows it needs rather than running into the next
   * day, and reading each cell the way it is written ("3x5", "80%", "@8").
   */
  function pasteText(raw: string, start: Coord) {
    const text = raw.replace(/\r/g, "").replace(/\n$/, "");
    const clip = rowClip;
    if (clip && clip.text === text) {
      if (clip.cols === null) return pasteClip(clip, start[0]);
      if (navKeys[start[1]] === clip.cols[0]) return pasteClip(clip, start[0]);
    }

    if (!/[\t\n]/.test(text)) {
      const box = spans && rect ? rect : { r1: start[0], r2: start[0], c1: start[1], c2: start[1] };
      const writes: CellWrite[] = [];
      for (let r = box.r1; r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) writes.push({ r, c, text });
      return writeCells("paste", writes);
    }

    const slot = nav.slots.get(start[0]);
    if (!slot) return;
    const { day } = slot;
    const first = slot.row ? day.rows.indexOf(slot.row) : day.rows.length;
    const { newRow } = activeSettings();
    const update: Templated[] = [];
    const before: Templated[] = [];
    const create: Templated[] = [];
    let dropped = 0;
    let width = 1;

    text.split("\n").forEach((line, i) => {
      const target = day.rows[first + i];
      const template = rowTemplate(target ?? blankRow("", day));
      const values = line.split("\t");
      width = Math.max(width, values.length);
      let named = false;
      let sorted = false;
      const written = new Set<string>();
      values.forEach((value, dc) => {
        const col = navKeys[start[1] + dc];
        if (col === undefined || col === "progression") return;
        const parsed = parseCell(col, value, template.intensityType);
        if (!parsed) return void dropped++;
        // An empty cell clears its own field, but not one a cell before it wrote: the
        // blank REPS beside a "4x6" in SETS.
        if (value.trim() === "") for (const key of Object.keys(parsed)) if (written.has(key)) delete (parsed as Record<string, unknown>)[key];
        Object.assign(template, parsed);
        if (value.trim() !== "") {
          for (const key of Object.keys(parsed)) written.add(key);
          named ||= col === "exercise";
          sorted ||= col === "target";
        }
      });
      // A name brings its target and tier, as typing it would, unless the paste or the coach set them.
      if (named) {
        template.exercise = resolveAlias(template.exercise);
        const untouched = !target || (target.target === newRow.target && target.tier === newRow.tier);
        if (!sorted && untouched) Object.assign(template, classifyExercise(template.exercise));
      }
      if (target) {
        update.push({ id: target.id, template });
        before.push({ id: target.id, template: rowTemplate(target) });
      } else if (template.exercise.trim() !== "") {
        create.push({ id: crypto.randomUUID(), template });
      } else {
        // Past the day's last row with no exercise to name a new one: nowhere to go.
        dropped += values.filter((v) => v.trim() !== "").length;
      }
    });

    if (dropped > 0) notify(t("{n} cells could not take what was put in them", { n: dropped }));
    if (!commitPaste("paste", day.id, update, before, create)) return;
    const last = start[0] + update.length + create.length - 1;
    setSel({ a: start, b: [last, Math.min(NAV_COLS - 1, start[1] + width - 1)] });
  }

  /** Reads the system clipboard for a paste from a menu, where no paste event comes. */
  function pasteFromClipboard(start: Coord) {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) pasteText(text, start);
      })
      .catch(() => notify(t("The clipboard can't be read from a menu here. Press {key} instead.", { key: keyLabel("mod+v") })));
  }

  // On the document, not the grid: a row number has the focus after it is clicked, and a
  // button is no place a copy or paste event is sent to.
  useEffect(() => {
    document.addEventListener("copy", onGridCopy);
    document.addEventListener("cut", onGridCut);
    document.addEventListener("paste", onGridPaste);
    return () => {
      document.removeEventListener("copy", onGridCopy);
      document.removeEventListener("cut", onGridCut);
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

    const update: Templated[] = [];
    const before: Templated[] = [];
    const create: Templated[] = [];
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
    if (!commitPaste("paste rows", dayId, update, before, create)) return;

    // The pasted rows stay selected, the way a sheet leaves them.
    const last = start + update.length + create.length - 1;
    setSel(clip.cols === null ? { a: [start, 0], b: [last, NAV_COLS - 1] } : null);
  }

  /** Writes pasted rows onto a day as one undoable edit: `before` is what `update` wrote over. */
  function commitPaste(label: string, dayId: string, update: Templated[], before: Templated[], create: Templated[]) {
    if (update.length === 0 && create.length === 0) return false;
    setCopied(null);
    const redo = { update, create };
    const undo = { update: before, remove: create.map((c) => c.id) };
    const apply = (write: typeof redo | typeof undo) => {
      setBlock((b) => pastedLocally(b, dayId, write));
      return track(pasteRows(dayId, write));
    };
    startTransition(() => {
      void apply(redo);
    });
    history.push({ label, undo: () => apply(undo), redo: () => apply(redo), at: (update[0] ?? create[0]).id });
    return true;
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

  // A row moved to another day gets a new place; the focus follows it by its id.
  const pendingRow = useRef<string | null>(null);

  useEffect(() => {
    const moved = pendingRow.current;
    if (moved !== null) {
      const el = document.querySelector<HTMLInputElement>(`[data-row="${moved}"] [data-nav$="-1"] input`);
      if (el) {
        pendingRow.current = null;
        el.focus();
        el.select();
      }
    }

    const slot = pendingFocus.current;
    if (slot === null) return;

    // A row can take two revalidations to settle (the edit that named the row above it,
    // then the insert). Hold the claim until the cell is actually there.
    const el =
      document.querySelector<HTMLElement>(`[data-nav="${slot}"] input`) ??
      document.querySelector<HTMLElement>(`[data-nav="${slot}"] button`);
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

      case "day-copy":
      case "day-move": {
        if (id === "day-copy" && day.rows.every(isBlank)) return false;
        handled();
        const weekday = t(WEEKDAYS[weekdayOfDay(block.startDate, day.index)]);
        pickDay(day, `${t("Week {n}", { n: activeWeek })} · ${weekday}`, id === "day-move");
        return true;
      }

      case "day-paste": {
        if (!dayClip || dayClip.id === day.id) return false;
        handled();
        dropDay(day);
        return true;
      }

      case "day-rename": {
        if (day.rest) return false;
        handled();
        const input = document.querySelector<HTMLInputElement>(`#day-${day.id} [data-day-name] input`);
        input?.focus();
        input?.select();
        return true;
      }

      case "row-recalc": {
        if (!row || row.load === null) return false;
        handled();
        patchCell(row.id, { load: null });
        return true;
      }

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

      case "row-insert-above": {
        if (!row) return false;
        pendingFocus.current = `${index}-1`;
        const id = crypto.randomUUID();
        return tracked(
          "insert row",
          () => insertRow(day.id, row.order - 1, { id }),
          () => deleteRow(id),
        );
      }

      case "row-tier": {
        // The next tier round, for a keyboard that can't reach the badge.
        if (!row) return false;
        const offered = TIERS.filter((x) => tiers[x].show || x === row.tier);
        const tier = offered[(offered.indexOf(row.tier) + 1) % offered.length];
        const was = row.tier;
        if (tier === was) return false;
        return tracked(
          "tier",
          () => updateRow(row.id, { tier }),
          () => updateRow(row.id, { tier: was }),
        );
      }

      case "row-fill-next":
      case "row-fill-later": {
        if (!row || lastWeek) return false;
        handled();
        // From the keys, with nothing selected, the cell with focus is the box.
        const at = coordOf(document.activeElement);
        const box = rect ?? (at ? { r1: at[0], r2: at[0], c1: at[1], c2: at[1] } : null);
        fillWeeks(id === "row-fill-next" ? "next" : "later", box, index);
        return true;
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
        handled();
        deleteRows([{ row, dayId: day.id }]);
        return true;
      }

      case "row-up":
      case "row-down": {
        if (!row) return false;
        const up = id === "row-up";
        // The selected rows of this day when this one is among them, else just this one.
        const picked =
          rect && spans && index >= rect.r1 && index <= rect.r2
            ? day.rows.filter((r) => {
                const i = nav.rows.get(r.id);
                return i !== undefined && i >= rect.r1 && i <= rect.r2;
              })
            : [row];
        // Nearest the way they move goes first, and a block already at the day's edge stays.
        const order = up ? picked : [...picked].reverse();
        if (order[0] === (up ? day.rows[0] : day.rows[day.rows.length - 1])) {
          // At the day's edge one row carries on into the next day that is trained.
          return picked.length === 1 && !isBlank(row) ? moveAcross(row, day, index, up, handled) : false;
        }
        if (sel && picked.length > 1) {
          const d = up ? -1 : 1;
          setSel({ a: [sel.a[0] + d, sel.a[1]], b: [sel.b[0] + d, sel.b[1]] });
        }
        return tracked(
          picked.length > 1 ? "move rows" : "move row",
          async () => {
            for (const r of order) await moveRow(r.id, up ? "up" : "down");
          },
          async () => {
            for (const r of [...order].reverse()) await moveRow(r.id, up ? "down" : "up");
          },
        );
      }

      case "row-paste-prescription": {
        const clip = rowClip;
        if (clip === null) return false;
        handled();
        // Every column but TARGET and EXERCISE: the same scheme onto other lifts.
        const cols = (Object.keys(COL_FIELDS) as NavKey[]).filter((k) => k !== "target" && k !== "exercise");
        pasteClip({ ...clip, cols }, index);
        return true;
      }

      case "day-next":
      case "day-prev": {
        // The first row of the next day, or of the previous one, in the same column.
        let s = index;
        const step = id === "day-next" ? 1 : -1;
        const dayAt = (i: number) => nav.slots.get(i)?.day.id;
        while (dayAt(s + step) === day.id) s += step;
        s += step;
        if (dayAt(s) === undefined) return false;
        while (step < 0 && dayAt(s - 1) === dayAt(s)) s--;
        handled();
        const c = coordOf(document.activeElement)?.[1] ?? 1;
        setSel({ a: [s, c], b: [s, c] });
        focusNav(`${s}-${c}`);
        return true;
      }

      case "meet-fill": {
        const meet = meetByDay.get(day.id);
        if (!meet) return false;
        return act(() => {
          void fillMeet(day.id, meet.id);
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

  /**
   * Carries a row over the edge of its day: to the end of the day before, or the top of
   * the day after. It keeps its id, so what the athlete logged on it comes along.
   */
  function moveAcross(row: RowData, day: DayData, index: number, up: boolean, handled: () => void) {
    const step = up ? -1 : 1;
    let s = index;
    while (nav.slots.get(s + step)?.day.id === day.id) s += step;
    const target = nav.slots.get(s + step)?.day;
    if (!target) return false;
    handled();
    // The end of a day is above its unnamed last row, which stays last.
    moveRows([row.id], target.id, up ? target.rows.length - (isBlank(target.rows.at(-1)) ? 1 : 0) : 0);
    return true;
  }

  /** Moves rows to `index` among the rest of a day's, as one undoable edit; the focus follows them. */
  function moveRows(ids: string[], dayId: string, index: number) {
    let placed: Awaited<ReturnType<typeof moveRowsTo>> | null = null;
    pendingRow.current = ids[0];
    setSel(null);
    edit(
      ids.length > 1 ? "move rows" : "move row",
      async () => {
        placed = await moveRowsTo(ids, dayId, index);
      },
      async () => {
        if (placed) await placeRows(placed.was, placed.lost);
      },
    );
  }

  /**
   * Fills rows into the next week, or every later week, as one undo step. Inside `box` it
   * takes the box's rows and only its columns' fields (whole rows when the box spans every
   * column); outside it, the one row whole. Rule-driven fields step on from this week.
   */
  function fillWeeks(scope: "next" | "later", box: Box | null, index: number) {
    const inBox = box !== null && index >= box.r1 && index <= box.r2;
    const span = inBox ? Array.from({ length: box.r2 - box.r1 + 1 }, (_, k) => box.r1 + k) : [index];
    const ids = span.flatMap((r) => {
      const row = nav.slots.get(r)?.row;
      return row && !isBlank(row) ? [row.id] : [];
    });
    const whole = !inBox || (box.c1 === 0 && box.c2 === NAV_COLS - 1);
    const fields = whole ? null : [...new Set(navKeys.slice(box.c1, box.c2 + 1).flatMap((k) => FILL_FIELDS[k]))];
    if (ids.length === 0 || fields?.length === 0) return;

    let done: FillResult | null = null;
    edit(
      scope === "next" ? "fill next week" : "fill later weeks",
      async () => {
        done = await fillForward(ids, fields, scope);
        if (done && done.skipped > 0) notify(t("{n} locked weeks left as they were", { n: done.skipped }));
      },
      async () => {
        if (done) await undoFill(done);
      },
    );
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
  useCommands("grid", readOnly ? NO_COMMANDS : rowCommands);
  const findCommands = useMemo<Command[]>(
    () => [{ id: "find-replace", group: "Edit", title: t("Find and replace"), run: () => setFinding(true) }],
    [],
  );
  useCommands("grid-find", readOnly ? NO_COMMANDS : findCommands);

  /** Every place the text is found, in the columns and weeks asked for: a row and which of its fields. */
  function findHits(query: string, where: FindIn) {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    return block.weeks
      .filter((w) => where.scope === "phase" || w.order === activeWeek)
      .flatMap((w) => w.days.flatMap((d) => d.rows))
      .flatMap((row) => where.fields.filter((f) => (row[f] ?? "").toLowerCase().includes(q)).map((field) => ({ row, field })));
  }

  /** Lights up the next place the text is found in the week on screen, and scrolls to it. */
  function findNext(query: string, where: FindIn) {
    const cols = { exercise: navKeys.indexOf("exercise"), target: 0, coachNotes: navKeys.indexOf("notes") };
    const here = findHits(query, where)
      .flatMap(({ row, field }): Coord[] => {
        const r = nav.rows.get(row.id);
        return r === undefined || cols[field] < 0 ? [] : [[r, cols[field]]];
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (here.length === 0) {
      setFound(null);
      if (query.trim() !== "") notify(t("Not in this week"));
      return;
    }
    const after = found ? here.findIndex(([r, c]) => r > found[0] || (r === found[0] && c > found[1])) : 0;
    const next = here[Math.max(0, after)];
    setFound(next);
    gridRef.current
      ?.querySelector(`[data-nav="${next[0]}-${next[1]}"]`)
      ?.scrollIntoView({ block: "center", inline: "nearest" });
  }

  /** Replaces the text wherever it is found, in the columns and weeks asked for, as one undoable edit. */
  function replaceAll(query: string, replacement: string, where: FindIn) {
    const pattern = new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const patches = new Map<string, { next: Record<string, string | null>; prev: Record<string, string | null> }>();
    let cells = 0;
    for (const { row, field } of findHits(query, where)) {
      const now = (row[field] ?? "").replace(pattern, () => replacement).trim();
      // A row can't lose its name or its target to a replace; a note can be emptied.
      if (now === "" && field !== "coachNotes") continue;
      const entry = patches.get(row.id) ?? { next: {}, prev: {} };
      entry.next[field] = now === "" ? null : now;
      entry.prev[field] = row[field];
      patches.set(row.id, entry);
      cells++;
    }
    if (cells === 0) return;

    const apply = (pick: "next" | "prev") => {
      setBlock((b) => mapRows(b, (r) => (patches.has(r.id) ? ({ ...r, ...patches.get(r.id)![pick] } as RowData) : r)));
      return track(
        (async () => {
          // ponytail: one row at a time — a save syncs the weeks after it, and two at once
          // would race. One server action for the lot if a big program feels slow.
          for (const [id, patch] of patches) {
            const { coachNotes, ...own } = patch[pick];
            if (Object.keys(own).length > 0) await updateRow(id, own as Parameters<typeof updateRow>[1]);
            if (coachNotes !== undefined) await updateCell(id, { coachNotes });
          }
        })(),
      );
    };
    void apply("next");
    history.push({ label: "replace", undo: () => apply("prev"), redo: () => apply("next") });
    setFound(null);
    notify(t("Replaced in {n} cells", { n: cells }));
  }

  /** Whether the focus is in a cell being edited, whose caret owns Home, End and Ctrl+arrows. */
  function editingText(target: EventTarget | null) {
    return target instanceof HTMLInputElement && "editing" in target.dataset;
  }

  /** Makes `to` the active cell, or with `extend` grows the selection to it instead. */
  function goTo(at: Coord, to: Coord, extend: boolean) {
    const next: Coord = [
      Math.max(0, Math.min(nav.count - 1, to[0])),
      Math.max(0, Math.min(NAV_COLS - 1, to[1])),
    ];
    if (extend) {
      setSel({ a: sel?.a ?? at, b: next });
      gridRef.current
        ?.querySelector(`[data-nav="${next[0]}-${next[1]}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    setSel({ a: next, b: next });
    focusNav(`${next[0]}-${next[1]}`);
  }

  /** Where Ctrl+arrow lands, as in a sheet: the end of a run of filled cells, else the next filled one. */
  function edgeOf(from: Coord, dr: number, dc: number): Coord {
    const inside = (r: number, c: number) => r >= 0 && r < nav.count && c >= 0 && c < NAV_COLS;
    const filled = (r: number, c: number) => readCell(r, c) !== "";
    let [r, c] = from;
    if (!inside(r + dr, c + dc)) return from;
    const run = filled(r, c) && filled(r + dr, c + dc);
    do {
      r += dr;
      c += dc;
    } while (inside(r + dr, c + dc) && (run ? filled(r + dr, c + dc) : !filled(r, c)));
    return [r, c];
  }

  /** How many rows a PgUp or PgDn moves: about a screenful. */
  function pageRows(at: Coord) {
    const cell = gridRef.current?.querySelector(`[data-nav="${at[0]}-${at[1]}"]`);
    const height = cell?.getBoundingClientRect().height || 32;
    return Math.max(1, Math.floor((gridRef.current?.parentElement?.clientHeight ?? 600) / height) - 2);
  }

  /** The spreadsheet keys: Tab across, shift+arrows to select, jumps, fills, clear. */
  function onSheetKey(e: React.KeyboardEvent): boolean {
    const at = coordOf(e.target);
    if (!at) return false;
    const mod = e.ctrlKey || e.metaKey;
    const typing = editingText(e.target);

    // Inside a selection Enter and Tab walk its cells and keep it, the way a sheet does.
    if ((e.key === "Enter" || e.key === "Tab") && !mod && !e.altKey && spans && rect) {
      e.preventDefault();
      const h = rect.r2 - rect.r1 + 1;
      const w = rect.c2 - rect.c1 + 1;
      const across = e.key === "Tab";
      const i = across ? (at[0] - rect.r1) * w + (at[1] - rect.c1) : (at[1] - rect.c1) * h + (at[0] - rect.r1);
      const n = (i + (e.shiftKey ? -1 : 1) + h * w) % (h * w);
      const next = across
        ? [rect.r1 + Math.floor(n / w), rect.c1 + (n % w)]
        : [rect.r1 + (n % h), rect.c1 + Math.floor(n / h)];
      focusNav(`${next[0]}-${next[1]}`);
      return true;
    }

    if (!typing && e.key.startsWith("Arrow") && mod) {
      e.preventDefault();
      const d = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }[e.key];
      if (!d) return true;
      const head = e.shiftKey && sel ? sel.b : at;
      goTo(at, edgeOf(head, d[0], d[1]), e.shiftKey);
      return true;
    }

    if (!typing && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      const end = e.key === "End";
      const head = e.shiftKey && sel ? sel.b : at;
      const to: Coord = mod ? (end ? [nav.count - 1, NAV_COLS - 1] : [0, 0]) : [head[0], end ? NAV_COLS - 1 : 0];
      goTo(at, to, e.shiftKey);
      return true;
    }

    if (e.key === "PageDown" || e.key === "PageUp") {
      if (e.altKey || mod) return false;
      e.preventDefault();
      const head = e.shiftKey && sel ? sel.b : at;
      const step = pageRows(at) * (e.key === "PageDown" ? 1 : -1);
      goTo(at, [head[0] + step, head[1]], e.shiftKey);
      return true;
    }

    if (!typing && e.key === " " && (e.shiftKey || mod) && !e.altKey) {
      e.preventDefault();
      const box = rect ?? { r1: at[0], r2: at[0], c1: at[1], c2: at[1] };
      // Shift+Space takes the rows, Ctrl+Space the columns, both together everything.
      const rows: [number, number] = mod ? [0, nav.count - 1] : [box.r1, box.r2];
      const cols: [number, number] = e.shiftKey ? [0, NAV_COLS - 1] : [box.c1, box.c2];
      setSel({ a: [rows[0], cols[0]], b: [rows[1], cols[1]] });
      return true;
    }

    if (!typing && mod && !e.shiftKey && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      // The day the focus is in; pressed again, the whole week.
      const day = nav.slots.get(at[0])?.day.id;
      let r1 = at[0];
      let r2 = at[0];
      while (nav.slots.get(r1 - 1)?.day.id === day) r1--;
      while (nav.slots.get(r2 + 1)?.day.id === day) r2++;
      const whole = wholeRows && rect?.r1 === r1 && rect?.r2 === r2;
      setSel(whole ? { a: [0, 0], b: [nav.count - 1, NAV_COLS - 1] } : { a: [r1, 0], b: [r2, NAV_COLS - 1] });
      return true;
    }

    if (mod && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      // The left column fills the rest of the block; one cell takes the cell to its left.
      const box = spans && rect ? rect : { r1: at[0], r2: at[0], c1: at[1] - 1, c2: at[1] };
      if (box.c1 < 0) return true;
      const writes: CellWrite[] = [];
      for (let r = box.r1; r <= box.r2; r++) {
        const source = readCell(r, box.c1);
        for (let c = box.c1 + 1; c <= box.c2; c++) writes.push({ r, c, text: source });
      }
      writeCells("fill right", writes);
      return true;
    }

    if (e.key === "Delete" && !spans && !typing && !mod) {
      e.preventDefault();
      writeCells("clear cells", [{ r: at[0], c: at[1], text: "" }]);
      return true;
    }

    if (e.key === "Tab") {
      // Off the end of a row Tab wraps onto the next one, and Shift+Tab back onto the last.
      let r = at[0];
      let c = at[1] + (e.shiftKey ? -1 : 1);
      if (c >= NAV_COLS) [r, c] = [r + 1, 0];
      else if (c < 0) [r, c] = [r - 1, NAV_COLS - 1];
      if (r < 0 || r >= nav.count) return false;
      e.preventDefault();
      tabCol.current ??= at[1];
      setSel({ a: [r, c], b: [r, c] });
      focusNav(`${r}-${c}`);
      return true;
    }

    if (mod && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      // With a block selected the top row fills the rest; with one cell, the cell above
      // fills into it.
      const box = spans && rect ? rect : { r1: at[0] - 1, r2: at[0], c1: at[1], c2: at[1] };
      if (box.r1 < 0) return true;
      const writes: CellWrite[] = [];
      for (let c = box.c1; c <= box.c2; c++) {
        const source = readCell(box.r1, c);
        for (let r = box.r1 + 1; r <= box.r2; r++) writes.push({ r, c, text: source, from: box.r1 });
      }
      writeCells("fill down", writes);
      return true;
    }

    if (mod && e.key === "Enter" && spans && rect) {
      e.preventDefault();
      // What was typed in the active cell goes into every selected cell, as in a sheet.
      // The cell's own Enter has already committed it; this writes the rest.
      const text = readCell(at[0], at[1]);
      const writes: CellWrite[] = [];
      for (let r = rect.r1; r <= rect.r2; r++)
        for (let c = rect.c1; c <= rect.c2; c++) writes.push({ r, c, text, from: at[0] });
      writeCells("fill selection", writes);
      focusNav(`${at[0]}-${at[1]}`);
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
      // Rows picked by their numbers go; a block of cells is only emptied.
      clearBox(rect, "clear cells");
      return true;
    }

    return false;
  }

  /** Arrows walk the grid; left/right only jump once the caret is at the edge of the text. */
  function onNavKey(e: React.KeyboardEvent) {
    // Escape puts away what is only pending: the copy's frame, a find, a picked-up day.
    if (e.key === "Escape") {
      setCopied(null);
      setFound(null);
      if (dayClip) setDayClip(null);
      return;
    }
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
    // Only a cell being edited has a caret for left and right to move.
    const editing = input !== null && "editing" in input.dataset;
    let next: [number, number];

    if (input && !editing && !input.readOnly) {
      if (e.key === "F2") {
        e.preventDefault();
        startEditing(input);
        return;
      }
      // Typing over a selected cell replaces what is there, and edits from then on.
      const typing = (e.key.length === 1 || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (typing) input.dataset.editing = "";
    }

    // After Tabbing along a row, Enter starts the next one where the Tabs began.
    if (e.key === "Enter" && !e.shiftKey) next = [r + 1, tabCol.current ?? c];
    else if (e.key === "ArrowDown") next = [r + 1, c];
    else if (e.key === "ArrowUp" || e.key === "Enter") next = [r - 1, c];
    else if (e.key === "ArrowLeft") {
      if (editing && (input.selectionStart ?? 0) > 0) return;
      next = [r, c - 1];
    } else if (e.key === "ArrowRight") {
      if (editing && (input.selectionEnd ?? 0) < input.value.length) return;
      next = [r, c + 1];
    } else return;
    tabCol.current = null;

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

  /** Writes a meet's attempts onto its day; undo puts the day back as it was. */
  async function fillMeet(dayId: string, meetId: string) {
    const result = await fillMeetDay(dayId, meetId);
    if (!result.ok) return;
    let undo = result.undo;
    history.push({
      label: "fill attempts",
      undo: () => unfillMeetDay(undo),
      redo: async () => {
        const again = await fillMeetDay(dayId, meetId);
        if (again.ok) undo = again.undo;
      },
    });
  }

  /** Deletes rows as one undoable edit; undo puts each back where it was, id and all. */
  function deleteRows(rows: { row: RowData; dayId: string }[]) {
    if (rows.length === 0) return;
    const snapshots = rows.map(({ row, dayId }) => ({
      ...rowTemplate(row),
      id: row.id,
      dayId,
      order: row.order,
      fromId: row.fromId,
    }));
    // What the athlete had logged on each, in this week or the others the sync reaches.
    const lost = new Map<string, LoggedRow[]>();
    // One at a time: each delete re-syncs the week, and two at once would race.
    edit(
      rows.length === 1 ? "delete row" : "delete rows",
      async () => {
        for (const s of snapshots) lost.set(s.id, await deleteRow(s.id));
      },
      async () => {
        for (const s of snapshots) await restoreRow(s, lost.get(s.id));
      },
    );
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
      `${focusSession.current}:${rowId}:${Object.keys(patch).join()}`,
      rowId,
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

    // Not an undo step: an unnamed last row is the day's blank line, there or not.
    startTransition(() => {
      void track(addRow(day.id, { id, exercise: "" }));
    });
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
    if (patch.exercise.trim()) tutorialDid("exercise");

    edit(
      "exercise",
      () => updateRow(row.id, patch),
      () => updateRow(row.id, before),
    );
  }

  /** What the selection adds up to, where a sheet shows its sum. */
  const summary = (() => {
    if (!rect || !spans) return null;
    const byDay = new Map<string, ReturnType<typeof resolveDay>>();
    let rows = 0;
    let sets = 0;
    let reps = 0;
    let tonnage = 0;
    for (let r = rect.r1; r <= rect.r2; r++) {
      const slot = nav.slots.get(r);
      if (!slot?.row || isBlank(slot.row)) continue;
      const { day, row } = slot;
      if (!byDay.has(day.id)) byDay.set(day.id, resolveDay(day.rows, maxes));
      const n = row.sets ?? 0;
      rows++;
      sets += n;
      reps += n * (row.reps ?? 0);
      tonnage += n * (row.reps ?? 0) * (byDay.get(day.id)!.get(row.id)?.weight ?? 0);
    }
    if (rows === 0) return null;
    return [
      t("{n} rows", { n: rows }),
      `${sets} ${t("sets")}`,
      `${reps} ${t("reps")}`,
      ...(tonnage > 0 ? [`${Math.round(tonnage).toLocaleString()} ${athlete.unit === "LB" ? "lb" : "kg"}`] : []),
    ].join(" · ");
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {weekLabel === "tabs" && (
        <WeekTabs
          weeks={block.weeks}
          active={activeWeek}
          current={nowWeek}
          blockId={block.id}
          onSelect={onWeek}
          onAdded={() => onWeek(block.weeks.length + 1)}
          deleting={deletingWeek}
          onDeleting={onDeletingWeek}
          phaseLabel={block.phase}
          readOnly={readOnly}
        />
      )}

      <div className="flex-1 overflow-auto" style={{ scrollbarGutter: "stable" }} onScroll={() => paint.current()}>
        <div
          ref={gridRef}
          role="grid"
          aria-label={t("Programming")}
          inert={readOnly}
          style={{ minWidth: GRID_MIN_WIDTH, maxWidth: SHELL_MAX_WIDTH }}
          className={`quiet-placeholders relative mx-auto w-full pb-24 ${dragging ? "select-none" : ""}`}
          onKeyDown={onNavKey}
          onFocus={() => focusSession.current++}
          // Leaving a cell ends its editing; coming back selects it again.
          onBlur={(e) => {
            if (e.target instanceof HTMLInputElement) delete e.target.dataset.editing;
          }}
          onMouseDown={onGridMouseDown}
          onMouseOver={onGridMouseOver}
          onMouseMove={onGridMouseMove}
          onDoubleClick={onGridDoubleClick}
          // The browser's own drag of selected text would fight a drag across cells.
          onDragStart={(e) => e.preventDefault()}
        >
          <div ref={selFrame} className="pointer-events-none absolute z-20 hidden border border-accent bg-accent/10" />
          <div ref={copyFrame} className="pointer-events-none absolute z-20 hidden border border-dashed border-accent" />
          {/* Small to look at, with a wider ring round it to catch the mouse. */}
          <div
            ref={fillHandle}
            onMouseDown={onFillHandleDown}
            onDoubleClick={onFillHandleDouble}
            title={t("Drag to fill down or up. Double-click to fill to the end of the day.")}
            className="absolute z-20 hidden h-[9px] w-[9px] cursor-crosshair border border-surface bg-accent after:absolute after:-inset-1.5 after:content-['']"
          />
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
            layout={layout}
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
          const resolvedDay = resolveDay(day.rows, maxes);
          const tourDay = day.id === tourDayId;
          const meet = meetByDay.get(day.id);
          const weekday = t(WEEKDAYS[weekdayOfDay(block.startDate, day.index)]);
          /** Copy, move and paste the whole day — in its own menu and every row's. */
          const dayItems: MenuItem[] = [
            "divider",
            {
              label: t("Copy day"),
              disabled: day.rows.every(isBlank),
              onSelect: () => pickDay(day, `${t("Week {n}", { n: activeWeek })} · ${weekday}`, false),
            },
            {
              label: t("Move day"),
              onSelect: () => pickDay(day, `${t("Week {n}", { n: activeWeek })} · ${weekday}`, true),
            },
            {
              label: !dayClip
                ? t("Paste day here")
                : dayClip.move
                  ? t("Move “{name}” here", { name: dayClip.label })
                  : t("Paste “{name}” here", { name: dayClip.label }),
              disabled: !dayClip || dayClip.id === day.id,
              onSelect: () => dropDay(day),
            },
          ];
          /** The day's actions — its ⋯ and a right-click both open them. */
          const dayMenu = (e: React.MouseEvent) =>
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
              ...dayItems,
              ...(meet
                ? [
                    {
                      label: t("Fill a meet day with its attempts"),
                      onSelect: () =>
                        startTransition(() => {
                          void fillMeet(day.id, meet.id);
                        }),
                    },
                  ]
                : []),
            ]);
          const paused = day.rest ? null : (pausedBy?.(dayYmd(block.startDate, activeWeek, day.index)) ?? null);
          return (
            <section
              key={day.id}
              data-tour={tourDay ? "day" : undefined}
              id={`day-${day.id}`}
              onContextMenu={dayMenu}
              className={`scroll-mt-20 ${compact ? "mt-1" : "mt-2"} ${paused ? "opacity-50" : ""}`}
            >
              {/* One slim line per day, rest days included, so the dates line up down the week. */}
              <div className="group/day sticky left-0 z-10 flex w-fit items-center gap-2 px-4 py-1">
                {day.rest ? (
                  // The day's own name waits underneath for it to be trained on again.
                  <span title={dayName(day)} className="w-[150px] px-2 py-1.5 text-[13px] font-semibold text-muted-2">
                    {t("Rest")}
                  </span>
                ) : (
                  <span data-day-name className="contents">
                  <TextInput
                    value={day.label}
                    className="!w-auto min-w-[150px] max-w-[360px] !text-[13px] font-semibold [field-sizing:content]"
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
                <span title={fullDate(block.startDate, activeWeek, day.index)} className="cursor-help text-[11px] text-muted-2">
                  · {weekdayShort(weekdayOfDay(block.startDate, day.index))} {formatDate(dayOf(block.startDate, activeWeek, day.index))}
                </span>
                {dayYmd(block.startDate, activeWeek, day.index) === todayYmd && (
                  <span className="text-[11px] font-medium text-accent">{t("Today")}</span>
                )}
                {paused && (
                  <span
                    title={t("Only one program is trained at a time. Make this one active to train it here.")}
                    className="cursor-help rounded-full border border-border px-2 py-0.5 text-[11px] text-muted"
                  >
                    {t("Not trained — “{name}” is active", { name: paused })}
                  </span>
                )}
                {meet && (
                  <span
                    title={t("{name} — competition day", { name: meet.name })}
                    className="rounded border border-accent/60 bg-accent-soft px-1.5 py-0.5 text-[11px] tracking-wider text-accent"
                  >
                    MEET · {meet.name}
                  </span>
                )}
                {day.rest && (
                  <button
                    type="button"
                    onClick={() =>
                      edit(
                        "training day",
                        () => updateDay(day.id, { rest: false }),
                        () => updateDay(day.id, { rest: true }),
                      )
                    }
                    title={t("Make it a training day")}
                    className="rounded px-1.5 py-0.5 text-[10px] tracking-wider text-muted-2 opacity-60 hover:bg-surface-2 hover:text-foreground focus:opacity-100 group-hover/day:opacity-100"
                  >
                    + {t("TRAIN")}
                  </button>
                )}
                {dayClip && dayClip.id !== day.id && (
                  <button
                    type="button"
                    onClick={() => dropDay(day)}
                    className="rounded-full border border-accent/60 px-2 py-0.5 text-[11px] text-accent hover:bg-accent-soft"
                  >
                    {dayClip.move ? t("Move here") : t("Paste here")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={dayMenu}
                  title={t("Day actions")}
                  aria-label={t("Day actions")}
                  className="rounded px-1.5 text-[13px] leading-5 text-muted-2 opacity-60 hover:bg-surface-3 hover:text-foreground focus:opacity-100 group-hover/day:opacity-100"
                >
                  ⋯
                </button>
              </div>

              {!day.rest && (
                <div role="rowgroup" className="rounded-lg border-y border-border bg-surface">
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
                    const quietBadge = !tint && !ghost && row.tier === "ACCESSORY";
                    return (
                      <div
                        key={row.id}
                        role="row"
                        data-row={row.id}
                        data-slot={r}
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
                          // The cells the menu is about: the selection when the click is in it, else the cell.
                          const cell = coordOf(e.target);
                          const inSel =
                            cell !== null && rect !== null && spans && cell[0] >= rect.r1 && cell[0] <= rect.r2 && cell[1] >= rect.c1 && cell[1] <= rect.c2;
                          const box: Box | null = inSel ? rect : cell ? { r1: cell[0], r2: cell[0], c1: cell[1], c2: cell[1] } : null;
                          const put = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);
                          rowMenu.open(e, [
                            ...(box
                              ? [
                                  {
                                    label: t("Cut"),
                                    hint: keyLabel("mod+x"),
                                    onSelect: () => {
                                      put(copyCells(box));
                                      clearBox(box, "cut");
                                    },
                                  },
                                  { label: t("Copy"), hint: keyLabel("mod+c"), onSelect: () => put(copyCells(box)) },
                                  { label: t("Paste"), hint: keyLabel("mod+v"), onSelect: () => pasteFromClipboard([box.r1, box.c1]) },
                                  { label: t("Clear cells"), hint: keyLabel("delete"), onSelect: () => clearBox(box, "clear cells") },
                                  "divider" as const,
                                  {
                                    label: t("Fill next week"),
                                    hint: k("row-fill-next"),
                                    onSelect: () => fillWeeks("next", box, r),
                                    disabled: lastWeek || ghost,
                                  },
                                  {
                                    label: t("Fill later weeks"),
                                    hint: k("row-fill-later"),
                                    onSelect: () => fillWeeks("later", box, r),
                                    disabled: lastWeek || ghost,
                                  },
                                  "divider" as const,
                                ]
                              : []),
                            { label: t("Insert a row above"), hint: k("row-insert-above"), onSelect: run("row-insert-above"), disabled: ghost },
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
                            ...(row.load !== null
                              ? [{ label: t("Recalculate the weight"), onSelect: () => patchCell(row.id, { load: null }) }, "divider" as const]
                              : []),
                            { label: t("Move the row up"), hint: k("row-up"), onSelect: run("row-up"), disabled: i === 0 },
                            { label: t("Move the row down"), hint: k("row-down"), onSelect: run("row-down"), disabled: i === day.rows.length - 1 },
                            "divider",
                            { label: day.rest ? t("Make it a training day") : t("Make it a rest day"), hint: k("day-rest"), onSelect: run("day-rest") },
                            ...(meetByDay.get(day.id)
                              ? [{ label: t("Fill a meet day with its attempts"), hint: k("meet-fill"), onSelect: run("meet-fill") }]
                              : []),
                            ...dayItems,
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
                          className="flex items-center justify-center text-[11px] text-muted-2"
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
                            title={armed === row.id ? t("Click again to delete the row") : t("Delete row")}
                            aria-label={t("Delete row")}
                            // It sits beside the row number, so one stray click only arms it.
                            onClick={() => {
                              if (armed !== row.id) return setArmed(row.id);
                              setArmed(null);
                              deleteRows([{ row, dayId: day.id }]);
                            }}
                            onMouseLeave={() => setArmed(null)}
                            className={`absolute top-1/2 right-0 hidden w-2.5 -translate-y-1/2 rounded text-center ${ghost ? "" : "group-hover:block"} ${
                              armed === row.id ? "bg-miss text-white" : "text-muted-2 hover:text-miss"
                            }`}
                          >
                            ×
                          </button>
                        </StickyCell>

                        <StickyCell
                          left={40}
                          width={layout.targetW}
                          nav={`${r}-0`}
                          tinted={Boolean(tint)}
                          // Sets the row's height: the field fills it, so all of the cell is the cell.
                          className={`flex items-center gap-1.5 pl-2 ${compact ? "" : "min-h-[30px]"}`}
                        >
                          <TierPicker
                            tier={row.tier}
                            offered={TIERS.filter((t) => tiers[t].show || t === row.tier)}
                            colorOf={(t) => (own === null ? tierColors[t] : tierShade(own, t))}
                            className={`${ghostHide} ${
                              quietBadge ? "opacity-40 group-hover:opacity-100 group-focus-within:opacity-100" : ""
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
                          <span className={`h-full min-w-0 flex-1 ${ghostHide}`}>
                            <TextInput
                              value={row.target}
                              suggestions={targets}
                              className="!pl-0.5 !text-[12px]"
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

                        <StickyCell left={layout.exLeft} width={layout.exW} nav={`${r}-1`} tinted={Boolean(tint)} className="flex items-center">
                          <ExerciseInput
                            value={row.exercise}
                            history={exerciseHistory}
                            className={`font-medium ${ghost ? "keep-placeholder" : ""}`}
                            onCommit={(v, picked) => commitExercise(row, v, picked)}
                          />
                        </StickyCell>

                        <StickyCell
                          left={layout.progLeft}
                          width={layout.leftWidth - layout.progLeft}
                          tinted={Boolean(tint)}
                          nav={layout.showProgression ? `${r}-2` : undefined}
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

                          // A note long enough to need it wraps, as the coach's view setting says.
                          const wrapped = wrapNotes && Boolean(cell.coachNotes);
                          const resolved = resolvedDay.get(row.id) ?? {
                            label: "—",
                            weight: null,
                            ramp: [],
                          };

                          return (
                            <div key={w} className="contents">
                              {cols.map((col, k) => {
                                const at = `${r}-${k + layout.weekStart}`;
                                const last = k === cols.length - 1 ? "border-r border-border" : "";
                                if (col === "sets") {
                                  return (
                                    <GridCell key={col} nav={at} className={`${ghostHide} ${last}`}>
                                      <TextInput
                                        value={cell.sets === null ? null : String(cell.sets)}
                                        placeholder="—"
                                        className="text-center !text-[12px] tabular-nums"
                                        valid={(v) => parseCell("sets", v, cell.intensityType) !== null}
                                        format={(v) => {
                                          const sets = parseCell("sets", v, cell.intensityType)?.sets;
                                          return sets == null ? "" : String(sets);
                                        }}
                                        onCommit={(v) => {
                                          // "4", or "3x5", which is the reps as well.
                                          const parsed = parseCell("sets", v ?? "", cell.intensityType);
                                          if (parsed) patchCell(row.id, parsed as Partial<Prescription>);
                                        }}
                                      />
                                    </GridCell>
                                  );
                                }
                                if (col === "reps") {
                                  return (
                                    <GridCell key={col} nav={at} className={`${ghostHide} ${last}`}>
                                      <TextInput
                                        value={cell.reps === null ? null : repsText(cell)}
                                        placeholder="—"
                                        className="text-center !text-[12px] tabular-nums"
                                        valid={(v) => parseCell("reps", v, cell.intensityType) !== null}
                                        format={(v) => {
                                          const reps = parseCell("reps", v, cell.intensityType);
                                          return reps?.reps == null ? "" : repsText({ reps: reps.reps, repsMax: reps.repsMax });
                                        }}
                                        onCommit={(v) => {
                                          // "8", a range, "8-10" — or "3x5", which is the sets as well.
                                          const reps = parseCell("reps", v ?? "", cell.intensityType);
                                          if (reps) patchCell(row.id, reps as Partial<Prescription>);
                                        }}
                                      />
                                    </GridCell>
                                  );
                                }
                                if (col === "time") {
                                  return (
                                    <GridCell key={col} nav={at} className={`${ghostHide} ${last}`}>
                                      <TextInput
                                        value={formatDuration(cell.duration) || null}
                                        placeholder="—"
                                        className="text-center !text-[12px] tabular-nums"
                                        valid={(v) => v.trim() === "" || parseDuration(v) !== null}
                                        onCommit={(v) => {
                                          const duration = v === null ? null : parseDuration(v);
                                          if (v !== null && duration === null) return;
                                          patchCell(row.id, { duration });
                                        }}
                                      />
                                    </GridCell>
                                  );
                                }
                                if (col === "kind" || col === "intensity") {
                                  const Part = col === "kind" ? IntensityKind : IntensityAmount;
                                  return (
                                    <GridCell
                                      key={col}
                                      nav={at}
                                      tour={tourDay && i === 0 && col === "kind" ? "intensity" : undefined}
                                      className={`${ghostHide} ${last}`}
                                    >
                                      <Part
                                        value={cell}
                                        onCommit={(v) => {
                                          patchCell(row.id, v);
                                          tutorialDid("intensity");
                                        }}
                                      />
                                    </GridCell>
                                  );
                                }
                                if (col === "load") {
                                  // Shows what the intensity works out to; a number typed in wins (in the
                                  // accent), and clearing it goes back to the calculated weight.
                                  return (
                                    <GridCell
                                      key={col}
                                      nav={at}
                                      className={`${ghostHide} ${last}`}
                                      title={
                                        resolved.weight === null && cell.load === null && !ghost
                                          ? t("No weight to work out: this exercise has no 1RM to go by. Type a weight here to set one.")
                                          : undefined
                                      }
                                    >
                                      <NumberInput
                                        value={cell.load}
                                        // The unit is in the column's name, so a typed weight and a worked-out one read alike.
                                        placeholder={resolved.weight === null ? "—" : resolved.label.replace(/ (kg|lb)$/, "")}
                                        className={`tabular-nums ${cell.load === null ? "placeholder:!text-foreground" : "font-medium text-accent"}`}
                                        onCommit={(v) => patchCell(row.id, { load: v })}
                                      />
                                    </GridCell>
                                  );
                                }
                                const field = TEXT_FIELD[col];
                                const input = (
                                  <TextInput
                                    value={cell[field]}
                                    placeholder={col === "notes" ? t("add note") : col === "video" ? t("link") : "—"}
                                    className={
                                      col === "notes"
                                        ? `!text-[11px] italic text-muted ${wrapped ? "peer absolute inset-0 opacity-0 focus:opacity-100" : ""}`
                                        : col === "video"
                                          ? "!text-[11px] text-muted"
                                          : "text-center !text-[12px]"
                                    }
                                    onCommit={(v) => patchCell(row.id, { [field]: v })}
                                  />
                                );
                                return (
                                  <GridCell
                                    key={col}
                                    nav={at}
                                    className={`${col === "notes" ? "" : ghostHide} ${last}`}
                                  >
                                    {wrapped && col === "notes" ? (
                                      // The note shown whole, setting the row's height; the field
                                      // over it shows on one line again while it is edited.
                                      <div className="relative w-full self-stretch">
                                        {input}
                                        <div
                                          aria-hidden
                                          className="text-[11px] italic text-muted whitespace-pre-wrap break-words px-2 py-1.5 peer-focus:invisible"
                                        >
                                          {cell.coachNotes}
                                        </div>
                                      </div>
                                    ) : (
                                      input
                                    )}
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
                      layout={layout}
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
      {finding && !readOnly && (
        <FindBar
          count={(query, where) => findHits(query, where).length}
          onNext={findNext}
          onReplace={replaceAll}
          onClose={() => {
            setFinding(false);
            setFound(null);
          }}
        />
      )}
      {(notice || summary || dayClip || saving > 0 || saved) && (
        <div className="pointer-events-none absolute right-6 bottom-3 z-30 flex max-w-[80%] items-center gap-3 rounded-full border border-border bg-surface-2 px-3 py-1 text-[11px] text-muted shadow-lg shadow-black/30">
          {notice && (
            <span role="status" className="flex items-center gap-1.5 text-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
              {notice}
            </span>
          )}
          {dayClip && (
            <span className="pointer-events-auto flex items-center gap-2 text-foreground">
              {dayClip.move ? t("Moving “{name}”", { name: dayClip.label }) : t("Copying “{name}”", { name: dayClip.label })}
              <button type="button" onClick={() => setDayClip(null)} className="text-muted-2 hover:text-accent">
                {t("Cancel")}
              </button>
            </span>
          )}
          {summary && <span className="tabular-nums">{summary}</span>}
          {(saving > 0 || saved) && <span>{saving > 0 ? t("Saving…") : t("Saved")}</span>}
        </div>
      )}
      {rowMenu.menu}
    </div>
  );
}

/** Find and replace, over the grid's corner: Enter finds the next, Escape puts it away. */
function FindBar({
  count,
  onNext,
  onReplace,
  onClose,
}: {
  count: (query: string, where: FindIn) => number;
  onNext: (query: string, where: FindIn) => void;
  onReplace: (query: string, replacement: string, where: FindIn) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [where, setWhere] = useState<FindIn>({ fields: FIND_FIELDS.map(([f]) => f), scope: "phase" });
  const n = count(query, where);
  const chip = (on: boolean) =>
    `h-6 rounded-full border px-2 text-[11px] ${on ? "border-accent/60 bg-accent-soft text-accent" : "border-border text-muted-2 hover:text-foreground"}`;
  const toggle = (f: FindField) =>
    setWhere((w) => {
      const fields = w.fields.includes(f) ? w.fields.filter((x) => x !== f) : [...w.fields, f];
      // Always at least one column to look in.
      return fields.length === 0 ? w : { ...w, fields };
    });
  const field = "h-7 w-[150px] rounded border border-border bg-surface px-2 text-[12px] outline-none focus:border-accent";
  const button = "h-7 rounded border border-border px-2 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-40";
  return (
    <div
      role="search"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
      className="absolute top-11 right-6 z-30 flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-1.5 shadow-xl shadow-black/40"
    >
      <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={query}
        placeholder={t("Find")}
        aria-label={t("Find")}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onNext(query, where);
        }}
        className={field}
      />
      <input
        value={replacement}
        placeholder={t("Replace with")}
        aria-label={t("Replace with")}
        onChange={(e) => setReplacement(e.target.value)}
        className={field}
      />
      <span className="min-w-[70px] text-center text-[11px] tabular-nums text-muted-2">
        {query.trim() === "" ? "" : t("{n} found", { n })}
      </span>
      <button type="button" disabled={n === 0} onClick={() => onNext(query, where)} className={button}>
        {t("Next")}
      </button>
      <button
        type="button"
        disabled={n === 0}
        onClick={() => onReplace(query, replacement, where)}
        className={button}
      >
        {t("Replace all")}
      </button>
      <button type="button" aria-label={t("Close")} onClick={onClose} className="px-1.5 text-[13px] text-muted-2 hover:text-foreground">
        ×
      </button>
      </div>
      {/* What it looks through: the columns, and this week or the whole phase. */}
      <div className="flex items-center gap-1 px-0.5">
        <span className="mr-1 text-[10px] tracking-[0.12em] text-muted-2">{t("SEARCH IN")}</span>
        {FIND_FIELDS.map(([f, name]) => (
          <button key={f} type="button" aria-pressed={where.fields.includes(f)} onClick={() => toggle(f)} className={chip(where.fields.includes(f))}>
            {t(name)}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {(["week", "phase"] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            aria-pressed={where.scope === scope}
            onClick={() => setWhere((w) => ({ ...w, scope }))}
            className={chip(where.scope === scope)}
          >
            {scope === "week" ? t("This week") : t("Whole phase")}
          </button>
        ))}
      </div>
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
        <MenuOptions
          autoFocus={false}
          value={tier}
          options={offered.map((option) => ({ value: option, label: <>{badge(option)}<span className="truncate">{tierLabel(option)}</span></> }))}
          onPick={(option) => {
            setOpen(false);
            onPick(option);
          }}
          className="-m-1"
        />
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
    repsMax: row.repsMax,
    intensityType: row.intensityType,
    intensity: row.intensity,
    intensityMax: row.intensityMax,
    rampStep: row.rampStep,
    coachNotes: row.coachNotes,
    tempo: row.tempo,
    restTime: row.restTime,
    videoUrl: row.videoUrl,
    duration: row.duration,
    load: row.load,
  };
}

/** An unnamed row: the grid treats it as the day's ghost and exports leave it out. */
function isBlank(row: RowData | undefined) {
  return row !== undefined && row.exercise.trim() === "";
}

/** A row's optimistic shape, matching what `addRow` writes on the server. */
function blankRow(id: string, day: DayData): RowData {
  const newRow = activeSettings().newRow;
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
    repsMax: null,
    intensityType: newRow.intensityType,
    intensity: newRow.intensity,
    intensityMax: null,
    rampStep: null,
    coachNotes: null,
    tempo: null,
    restTime: null,
    videoUrl: null,
    duration: null,
    load: null,
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
  layout,
  slot,
  onEnter,
}: {
  template: string;
  cols: WeekCol[];
  layout: ReturnType<typeof gridLayout>;
  slot: number;
  onEnter: (col: number) => void;
}) {
  // PROGRESSION is a keyboard column only while it shows.
  const start = layout.weekStart;

  function cell(col: number, placeholder: string, align = "text-center") {
    return (
      <input
        readOnly
        value=""
        placeholder={placeholder}
        onFocus={() => onEnter(col)}
        className={`${inputBase} ${align} cursor-text ${col === 1 ? "keep-placeholder" : ""}`}
      />
    );
  }

  return (
    <div
      role="row"
      data-slot={slot}
      className="group grid items-stretch border-t border-dashed border-border opacity-60 focus-within:opacity-100 hover:opacity-100"
      style={{ gridTemplateColumns: template }}
    >
      <StickyCell left={0} width={40} className="grid place-items-center text-[13px] text-muted-2">
        +
      </StickyCell>
      <StickyCell left={40} width={layout.targetW} nav={`${slot}-0`} className="flex items-center pl-2">
        {cell(0, t("target"), "text-left")}
      </StickyCell>
      <StickyCell left={layout.exLeft} width={layout.exW} nav={`${slot}-1`} className="flex items-center">
        {cell(1, t("add exercise"), "text-left")}
      </StickyCell>
      <StickyCell
        left={layout.progLeft}
        width={layout.leftWidth - layout.progLeft}
        nav={start === 3 ? `${slot}-2` : undefined}
        className="flex items-center border-r border-border"
      >
        {start === 3 ? cell(2, "") : null}
      </StickyCell>
      {cols.map((col, k) => (
        <GridCell
          key={col}
          nav={`${slot}-${k + start}`}
          className={k === cols.length - 1 ? "border-r border-border" : ""}
        >
          {cell(k + start, col === "notes" ? t("add note") : "—", col === "notes" ? "text-left" : "text-center")}
        </GridCell>
      ))}
    </div>
  );
}

function WeekTabs({
  weeks,
  active,
  current,
  blockId,
  onSelect,
  onAdded,
  deleting,
  onDeleting,
  phaseLabel,
  readOnly = false,
}: {
  /** The phase's name, for what a copied week is called on the clipboard. */
  phaseLabel: string;
  /** Weeks only switch: nothing to add, delete or paste. */
  readOnly?: boolean;
  weeks: { id: string; order: number; locked: boolean }[];
  active: number;
  /** The week being trained today, if it is in this phase. */
  current?: number | null;
  blockId: string;
  onSelect: (week: number) => void;
  onAdded: () => void;
  deleting?: number | null;
  onDeleting?: (week: number | null) => void;
}) {
  const [, startTransition] = useTransition();
  const [ownConfirmWeek, setOwnConfirmWeek] = useState<number | null>(null);
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
      {
        label: t("Fill later weeks from week {n}", { n: w }),
        onSelect: () => fillWeekUndoable(history, week.id),
        disabled: w === weeks.length,
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
          onContextMenu={readOnly ? undefined : (e) => menuFor(e, weeks.find((x) => x.order === w)!)}
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
            {w === current && <span title={t("This week")} className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />}
          </button>
          {locked && (
            <span title={t("Week {n} is locked", { n: w })} className="pl-1 text-accent">
              <LockIcon locked size={11} />
            </span>
          )}
          {!readOnly && w === active && (
            <button
              type="button"
              title={t("Week actions")}
              aria-label={t("Week actions")}
              onClick={(e) => menuFor(e, weeks.find((x) => x.order === w)!)}
              className="py-2 pl-1.5 text-[13px] leading-none text-muted-2 hover:text-foreground"
            >
              ⋯
            </button>
          )}
          {!readOnly && weeks.length > 1 && (
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
              let snapshot = await deleteWeek(blockId, target);
              if (!snapshot) return;
              history.push({
                label: "delete week",
                undo: async () => {
                  if (snapshot) await restoreWeek(blockId, snapshot);
                  onSelect(target);
                },
                redo: async () => {
                  snapshot = await deleteWeek(blockId, target);
                  onSelect(Math.max(1, target - 1));
                },
              });
            }}
          />
        </Popover>
      )}
      {!readOnly && (
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
          startTransition(() => addWeekUndoable(history, blockId, weeks.length + 1));
        }}
        className="ml-2 shrink-0 whitespace-nowrap px-2 py-2 text-[12px] text-muted hover:text-accent"
      >
        + {t("add week")}
      </button>
      )}
      {!readOnly && active < weeks.length && (
        <button
          type="button"
          title={t("Copy week {n} into every later week, rules stepping on from it", { n: active })}
          onClick={() => {
            const from = weeks.find((x) => x.order === active);
            if (from) fillWeekUndoable(history, from.id);
          }}
          className="shrink-0 whitespace-nowrap px-2 py-2 text-[12px] text-muted hover:text-accent"
        >
          {t("Fill later weeks")}
        </button>
      )}
      </div>

      {weekMenu.menu}
    </div>
  );
}

/** Fills a whole week into every later one as one undoable edit. */
function fillWeekUndoable(history: History, weekId: string) {
  let done: FillResult | null = null;
  const run = async () => {
    done = await fillWeekForward(weekId);
  };
  void run();
  history.push({
    label: "fill later weeks",
    undo: async () => {
      if (done) await undoFill(done);
    },
    redo: run,
  });
}

/** Adds a week to the end of a phase as one undoable edit; `order` is the number it gets. */
export function addWeekUndoable(history: History, blockId: string, order: number) {
  void addWeek(blockId);
  history.push({ label: "add week", undo: () => deleteWeek(blockId, order), redo: () => addWeek(blockId) });
}

/** The column toggle and undo / redo, beside whichever tab strip is showing. */
export function GridTools() {
  const tightIntensity = usePref("tightIntensity");
  const columns = usePref("columns");
  const hideRestDays = usePref("hideRestDays");
  const wrapNotes = usePref("wrapNotes");
  const columnWidths = usePref("columnWidths");
  const history = useHistory();
  const menu = useContextMenu();
  const mark = (on: boolean) => (on ? "✓" : undefined);
  return (
    <div data-tour="undo" className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-haspopup="menu"
        title={t("Columns")}
        aria-label={t("Columns")}
        onClick={(e) =>
          menu.open(e, [
            ...COLUMN_NAMES.map(([c, name]) => ({
              label: t(name),
              hint: mark(columns[c]),
              onSelect: () => setPref("columns", { ...columns, [c]: !columns[c] }),
            })),
            "divider" as const,
            { label: t("Keep intensity beside reps"), hint: mark(tightIntensity), onSelect: () => togglePref("tightIntensity") },
            { label: t("Hide rest days"), hint: mark(hideRestDays), onSelect: () => togglePref("hideRestDays") },
            { label: t("Wrap long coach notes"), hint: mark(wrapNotes), onSelect: () => togglePref("wrapNotes") },
            {
              label: t("Reset column widths"),
              disabled: Object.keys(columnWidths).length === 0,
              onSelect: () => resetPref("columnWidths"),
            },
          ])
        }
        className="grid size-8 place-items-center rounded-md border border-border text-muted hover:border-accent hover:text-accent"
      >
        <ColumnsIcon tight={tightIntensity} />
      </button>
      {menu.menu}
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
  layout,
}: {
  layout: ReturnType<typeof gridLayout>;
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
  const unit = athlete.unit === "LB" ? "lb" : "kg";

  function rename(label: string, apply: (name: string) => Promise<unknown>, was: string, next: string) {
    void apply(next);
    history.push({ label, undo: () => apply(was), redo: () => apply(next) });
  }

  /** A drag of a column's right edge: which column, and where the drag and its width began. */
  const resizing = useRef<{ key: NavKey; x: number; w: number } | null>(null);

  /** The strip on a column header's right edge that drags its width; a double-click gives it back. */
  function grip(key: NavKey) {
    return (
      <span
        aria-hidden
        title={t("Drag to resize. Double-click to reset.")}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          resizing.current = { key, x: e.clientX, w: e.currentTarget.parentElement!.getBoundingClientRect().width };
        }}
        onPointerMove={(e) => {
          const drag = resizing.current;
          if (!drag || drag.key !== key) return;
          const w = Math.round(Math.min(480, Math.max(48, drag.w + e.clientX - drag.x)));
          setPref("columnWidths", { ...getPref("columnWidths"), [key]: w });
        }}
        onPointerUp={() => {
          resizing.current = null;
        }}
        onDoubleClick={() => {
          const rest = { ...getPref("columnWidths") };
          delete rest[key];
          setPref("columnWidths", rest);
        }}
        className="absolute top-0 right-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-accent/40"
      />
    );
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
    <div className="sticky top-0 z-20 border-b border-border bg-background">
     <div className="grid" style={{ gridTemplateColumns: template }}>
      <StickyCell role="none" left={0} width={leftWidth} span={4} className="flex items-center gap-1 px-3 py-1.5">
        <span data-tour="names" className="flex min-w-0 flex-1 items-center gap-1">
        {/* data-focus: where the palette's rename commands put the caret. */}
        <span data-focus="program-name" className="contents">
        <TextInput
          value={block.program.name}
          placeholder={t("Program")}
          className={`${nameInput} font-medium`}
          valid={(v) => v.trim() !== ""}
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
          valid={(v) => v.trim() !== ""}
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
          <span className="text-[11px] text-muted-2">{unit}</span>
        </div>
      </div>
     </div>
      {/* The columns, named once for every day below. */}
      <div
        role="row"
        className="grid items-stretch border-t border-border text-[11px] tracking-[0.12em] text-muted-2"
        style={{ gridTemplateColumns: template }}
      >
        <StickyCell role="columnheader" left={0} width={40} className="px-2 py-1.5">
          #
        </StickyCell>
        <StickyCell role="columnheader" left={40} width={layout.targetW} className="px-2 py-1.5">
          <span data-col-head={0}>{t("TARGET")}</span>
          {grip("target")}
        </StickyCell>
        <StickyCell role="columnheader" left={layout.exLeft} width={layout.exW} className="px-2 py-1.5">
          <span data-col-head={1}>{t("EXERCISE")}</span>
          {grip("exercise")}
        </StickyCell>
        <StickyCell
          role="columnheader"
          left={layout.progLeft}
          width={leftWidth - layout.progLeft}
          className={`overflow-hidden border-r border-border ${layout.showProgression ? "px-2 py-1.5" : ""}`}
        >
          {layout.showProgression && <span data-col-head={2}>{t("PROGRESSION")}</span>}
          {layout.showProgression && grip("progression")}
        </StickyCell>
        {layout.cols.map((col, k) => (
          <div
            key={col}
            role="columnheader"
            data-col-head={k + layout.weekStart}
            className={`relative flex items-center bg-surface px-2 py-1.5 ${col === "notes" || col === "video" ? "justify-start" : "justify-center"} ${
              k === layout.cols.length - 1 ? "border-r border-border" : ""
            }`}
          >
            {t(WEEK_COL_LABEL[col])}
            {col === "load" ? ` (${unit})` : ""}
            {grip(col)}
          </div>
        ))}
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

function GridCell({
  children,
  className = "",
  nav,
  tour,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  nav?: string;
  tour?: string;
  title?: string;
}) {
  return (
    <div role="gridcell" data-nav={nav} data-tour={tour} title={title} className={`flex items-center ${className}`}>
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
  role = "gridcell",
}: {
  role?: string;
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
      role={role}
      data-nav={nav}
      data-tour={tour}
      className={`sticky z-10 ${tinted ? "bg-[color-mix(in_srgb,var(--tint)_9%,var(--surface))]" : "bg-surface"} ${className}`}
      style={{ left, width, gridColumn: `span ${span}` }}
    >
      {children}
    </div>
  );
}
