/**
 * Keyboard layer. Every command in the palette is bound by its id, and any of them can
 * take any key — or a two-stroke chord like `mod+k mod+s`. The defaults are `Alt`-based
 * except the palette: the grid is a wall of text inputs, so a bare letter always has to
 * reach the cell being typed into. A binding without Ctrl/⌘/Alt therefore only fires
 * while nothing editable has focus.
 */

import { getPref, setPref } from "@/lib/prefs";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** A stable name for a key press, independent of what the layout prints. */
export function hotkey(e: KeyboardEvent | React.KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");

  // Alt rewrites e.key on several layouts (Alt+D is "∂" on a Mac), so letters and
  // digits come off the physical key instead.
  const letter = /^Key([A-Z])$/.exec(e.code);
  const digit = /^Digit([0-9])$/.exec(e.code);
  const key = e.key === " " ? "space" : e.key.toLowerCase();
  parts.push(letter ? letter[1].toLowerCase() : digit ? digit[1] : key);

  return parts.join("+");
}

/** Keys that only modify another one — never a binding by themselves. */
export function isModifierKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return ["Control", "Alt", "Shift", "Meta", "AltGraph", "OS", "Dead", "Unidentified"].includes(e.key);
}

/** How a combo or chord is written in the UI. */
export function label(keys: string): string {
  const pretty: Record<string, string> = {
    mod: IS_MAC ? "⌘" : "Ctrl",
    alt: IS_MAC ? "⌥" : "Alt",
    shift: "⇧",
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    enter: "Enter",
    backspace: "Backspace",
    delete: "Del",
    escape: "Esc",
    space: "Space",
    tab: "Tab",
    pageup: "PgUp",
    pagedown: "PgDn",
    home: "Home",
    end: "End",
  };
  return keys
    .split(" ")
    .map((stroke) =>
      stroke
        .split("+")
        .map((part) => pretty[part] ?? part.toUpperCase())
        .join(IS_MAC ? "" : "+"),
    )
    .join(" ");
}

/** A stroke that works while typing in a cell: it holds Ctrl/⌘ or Alt, or is an F-key. */
export function firesWhileTyping(stroke: string): boolean {
  const parts = stroke.split("+");
  return parts.includes("mod") || parts.includes("alt") || /^f\d{1,2}$/.test(parts[parts.length - 1]);
}

/** Where a command applies. `grid`: it needs a focused row of the programming grid. */
export type When = "grid";

export type CommandSpec = {
  id: string;
  /** English, run through t() where shown. */
  title: string;
  group: string;
  keys?: string[];
  when?: When;
};

/**
 * Every built-in command, whichever screen registers it. The keyboard settings list
 * these, so a shortcut can be set before the command's screen has ever been opened.
 * Commands made up on the fly (open a given athlete, go to week 3) are bindable too;
 * the palette remembers their title when they get a key.
 */
export const COMMAND_SPECS: CommandSpec[] = [
  { id: "palette", group: "General", title: "Command palette", keys: ["mod+k", "mod+shift+p"] },
  { id: "quick-place", group: "General", title: "Go to…" },
  { id: "quick-athlete", group: "General", title: "Go to athlete…" },
  { id: "quick-week", group: "General", title: "Go to week…" },
  { id: "shortcuts", group: "General", title: "Keyboard shortcuts", keys: ["alt+/"] },
  { id: "keybindings", group: "General", title: "Customise keyboard shortcuts…" },

  { id: "undo", group: "Edit", title: "Undo", keys: ["mod+z"] },
  { id: "redo", group: "Edit", title: "Redo", keys: ["mod+y", "mod+shift+z"] },

  // Each screen's own, listed early so they lead that screen's palette.
  { id: "overview-running", group: "Overview", title: "Show only athletes running today" },
  { id: "overview-attention", group: "Overview", title: "Jump to needs attention" },
  { id: "overview-search", group: "Overview", title: "Search athletes" },

  { id: "view-review", group: "Tracking view", title: "Review", keys: ["alt+1"] },
  { id: "view-progress", group: "Tracking view", title: "Progress", keys: ["alt+2"] },
  { id: "view-wellness", group: "Tracking view", title: "Wellness", keys: ["alt+3"] },
  { id: "track-autosync", group: "Tracking view", title: "Refresh on its own: on / off" },
  { id: "track-link", group: "Tracking", title: "Athlete check-in link…" },

  { id: "session-next", group: "Session", title: "Next session", keys: ["alt+j"] },
  { id: "session-prev", group: "Session", title: "Previous session", keys: ["alt+k"] },
  { id: "session-expand", group: "Session", title: "Expand / collapse the session", keys: ["alt+o"] },
  { id: "session-expand-all", group: "Session", title: "Expand / collapse every session" },
  { id: "session-videos", group: "Session", title: "Videos for this session" },
  { id: "session-review", group: "Session", title: "Mark the session reviewed / not reviewed", keys: ["alt+x"] },
  { id: "session-feedback", group: "Session", title: "Write feedback for this session", keys: ["alt+f"] },
  { id: "session-next-unreviewed", group: "Session", title: "Next session to review", keys: ["alt+u"] },
  { id: "week-review-all", group: "Session", title: "Mark the whole week reviewed" },

  { id: "track-filter-all", group: "Filter", title: "Show every session" },
  { id: "track-filter-unreviewed", group: "Filter", title: "Show only sessions to review" },
  { id: "track-filter-offplan", group: "Filter", title: "Show only off-plan exercises" },
  { id: "track-filter-missed", group: "Filter", title: "Show only missed exercises" },
  { id: "track-filter-prs", group: "Filter", title: "Show only PRs" },
  { id: "track-lifts-all", group: "Filter", title: "Every exercise" },
  { id: "track-lifts-main", group: "Filter", title: "Only competition lifts" },
  { id: "track-lifts-variations", group: "Filter", title: "Only variations" },
  { id: "track-lifts-accessories", group: "Filter", title: "Only accessories" },
  { id: "track-toggle-sets", group: "Filter", title: "Expand every set: on / off" },
  { id: "track-toggle-upcoming", group: "Filter", title: "Show sessions still to come: on / off" },
  { id: "track-toggle-cues", group: "Filter", title: "Show coach notes, tempo and rest: on / off" },
  { id: "track-attention", group: "Filter", title: "Jump to what needs attention" },

  { id: "chart-lift-squat", group: "Chart", title: "Show / hide squat" },
  { id: "chart-lift-bench", group: "Chart", title: "Show / hide bench" },
  { id: "chart-lift-dead", group: "Chart", title: "Show / hide deadlift" },
  { id: "chart-e1rm-basis", group: "Chart", title: "Chart: logged e1RM / prescribed top set" },
  { id: "chart-range-phase", group: "Chart", title: "Chart range: this phase" },
  { id: "chart-range-program", group: "Chart", title: "Chart range: this program" },
  { id: "chart-range-12w", group: "Chart", title: "Chart range: 12 weeks" },
  { id: "chart-range-all", group: "Chart", title: "Chart range: everything" },
  { id: "chart-tonnage-by", group: "Chart", title: "Tonnage by lift / by target" },
  { id: "use-1rm-squat", group: "Chart", title: "Use the best e1RM as the squat 1RM" },
  { id: "use-1rm-bench", group: "Chart", title: "Use the best e1RM as the bench 1RM" },
  { id: "use-1rm-dead", group: "Chart", title: "Use the best e1RM as the deadlift 1RM" },
  { id: "checkins-range-14", group: "Chart", title: "Check-ins: 14 days" },
  { id: "checkins-range-28", group: "Chart", title: "Check-ins: 28 days" },
  { id: "checkins-range-56", group: "Chart", title: "Check-ins: 56 days" },
  { id: "checkins-low-only", group: "Chart", title: "Only low-readiness days: on / off" },
  { id: "readiness-per-question", group: "Chart", title: "Readiness as one score / per question" },
  { id: "bodyweight-add", group: "Chart", title: "Add a weigh-in" },

  { id: "meet-new", group: "Competition", title: "New meet…" },
  { id: "meet-rename", group: "Competition", title: "Rename meet" },
  { id: "meet-plan", group: "Competition", title: "Plan attempts from 1RMs" },
  { id: "meet-results", group: "Competition", title: "Save results as the new 1RMs" },

  { id: "week-prev", group: "Week", title: "Previous week", keys: ["alt+arrowleft"] },
  { id: "week-next", group: "Week", title: "Next week", keys: ["alt+arrowright"] },
  { id: "week-add", group: "Week", title: "Add a week", keys: ["alt+w"] },
  { id: "week-lock", group: "Week", title: "Lock / unlock the week", keys: ["alt+l"] },
  { id: "week-rest", group: "Week", title: "Rest / train the whole week" },
  { id: "week-copy", group: "Week", title: "Copy week" },
  { id: "week-duplicate", group: "Week", title: "Duplicate week" },
  { id: "week-paste", group: "Week", title: "Paste the copied week" },
  { id: "week-delete", group: "Week", title: "Delete the week…" },

  { id: "phase-prev", group: "Phase", title: "Previous phase", keys: ["alt+shift+arrowleft"] },
  { id: "phase-next", group: "Phase", title: "Next phase", keys: ["alt+shift+arrowright"] },
  { id: "phase-add", group: "Phase", title: "Add a phase" },
  { id: "phase-rename", group: "Phase", title: "Rename phase" },
  { id: "phase-maxes", group: "Phase", title: "Edit this phase's 1RMs" },
  { id: "phase-copy", group: "Phase", title: "Copy phase" },
  { id: "phase-duplicate", group: "Phase", title: "Duplicate phase" },
  { id: "phase-paste", group: "Phase", title: "Paste the copied phase" },
  { id: "phase-delete", group: "Phase", title: "Delete the phase…" },

  { id: "progressions", group: "Program", title: "Apply progressions", keys: ["alt+p"] },
  { id: "program-new", group: "Program", title: "New program…", keys: ["alt+n"] },
  { id: "program-settings", group: "Program", title: "Program settings…", keys: ["alt+,"] },
  { id: "program-rename", group: "Program", title: "Rename program" },
  { id: "program-import", group: "Program", title: "Import program file…" },
  { id: "program-copy", group: "Program", title: "Copy program…" },
  { id: "whole-program", group: "Program", title: "Whole program" },

  { id: "row-insert", group: "Row", title: "Insert a row below", keys: ["alt+enter"], when: "grid" },
  { id: "row-duplicate", group: "Row", title: "Duplicate the row", keys: ["alt+d"], when: "grid" },
  { id: "row-delete", group: "Row", title: "Delete the row", keys: ["alt+backspace"], when: "grid" },
  { id: "row-up", group: "Row", title: "Move the row up", keys: ["alt+arrowup"], when: "grid" },
  { id: "row-down", group: "Row", title: "Move the row down", keys: ["alt+arrowdown"], when: "grid" },
  { id: "row-copy", group: "Row", title: "Copy the row's prescription", keys: ["alt+c"], when: "grid" },
  { id: "row-paste", group: "Row", title: "Paste it onto this row", keys: ["alt+v"], when: "grid" },
  { id: "day-rest", group: "Row", title: "Training day / rest day", keys: ["alt+r"], when: "grid" },
  { id: "meet-fill", group: "Row", title: "Fill a meet day with its attempts", keys: ["alt+m"], when: "grid" },

  { id: "view-tight-intensity", group: "View", title: "Intensity beside reps / across the week" },
  { id: "view-sidebar", group: "View", title: "Collapse / expand the sidebar" },
  { id: "view-theme", group: "View", title: "Dark / light theme" },

  { id: "export-xlsx", group: "Export", title: "Export whole program .xlsx" },
  { id: "print-week", group: "Export", title: "Print this week" },
  { id: "print-phase", group: "Export", title: "Print every week of this phase" },
  { id: "export-pdf", group: "Export", title: "Export .pdf" },
  { id: "export-repwise", group: "Export", title: "Export for Repwise (.xlsx)" },
  { id: "export-repwise-tsv", group: "Export", title: "Export for Repwise (.tsv to paste)" },
  { id: "export-csv", group: "Export", title: "Export .csv" },

  { id: "sync-now", group: "Sync", title: "Sync now" },
  { id: "backup-download", group: "Backup", title: "Download backup" },
  { id: "backup-restore", group: "Backup", title: "Restore backup…" },

  { id: "athlete-new", group: "Athlete", title: "New athlete…" },
  { id: "athlete-link", group: "Athlete", title: "Athlete check-in link…" },
  { id: "athlete-example", group: "Athlete", title: "Add the example athlete" },
  { id: "athlete-prev", group: "Athlete", title: "Previous athlete" },
  { id: "athlete-next", group: "Athlete", title: "Next athlete" },

  { id: "refresh", group: "Sync", title: "Refresh what athletes logged" },


  { id: "go-overview", group: "Go", title: "Overview" },
  { id: "go-athletes", group: "Go", title: "The roster" },
  { id: "go-programming", group: "Go", title: "Programming" },
  { id: "go-tracking", group: "Go", title: "Tracking" },
  { id: "go-competition", group: "Go", title: "Competition" },
  { id: "go-settings", group: "Go", title: "Settings" },

  { id: "tutorial", group: "Help", title: "Start the tutorial" },
];

export const SPEC_BY_ID = new Map(COMMAND_SPECS.map((s) => [s.id, s]));

/** The keys a command has out of the box. */
export function defaultKeys(id: string): string[] {
  return SPEC_BY_ID.get(id)?.keys ?? [];
}

/** The keys a command answers to now: the coach's own, else its defaults. */
export function keysOf(id: string, overrides: Record<string, string[]> = getPref("keybindings")): string[] {
  return overrides[id] ?? defaultKeys(id);
}

/** The first key a command answers to, for showing beside it. */
export function primaryKey(id: string): string | null {
  return keysOf(id)[0] ?? null;
}

/** Gives a command exactly these keys; the defaults again when they match. */
export function setKeys(id: string, keys: string[], title?: string) {
  const next = { ...getPref("keybindings") };
  const same = keys.length === defaultKeys(id).length && keys.every((k, i) => k === defaultKeys(id)[i]);
  if (same) delete next[id];
  else next[id] = keys;
  setPref("keybindings", next);

  // A command that isn't built in keeps its title, so the settings can list it.
  if (!SPEC_BY_ID.has(id)) {
    const titles = { ...getPref("keybindingTitles") };
    if (next[id]?.length && title) titles[id] = title;
    else delete titles[id];
    setPref("keybindingTitles", titles);
  }
}

/** Adds a key to a command, taking it off every other command that had it. */
export function bindKey(id: string, keys: string, title?: string) {
  for (const other of clashes(id, keys)) {
    const theirs = keysOf(other).filter((k) => k !== keys);
    if (theirs.length !== keysOf(other).length) setKeys(other, theirs);
  }
  const mine = keysOf(id);
  if (!mine.includes(keys)) setKeys(id, [...mine, keys], title);
}

/** Every command id with at least one key, and its keys. */
export function allBindings(overrides: Record<string, string[]> = getPref("keybindings")): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const spec of COMMAND_SPECS) {
    const keys = overrides[spec.id] ?? spec.keys ?? [];
    if (keys.length > 0) out.set(spec.id, keys);
  }
  for (const [id, keys] of Object.entries(overrides)) {
    if (!SPEC_BY_ID.has(id) && keys.length > 0) out.set(id, keys);
  }
  return out;
}

/**
 * What a stroke means, given the one before it when a chord is under way. `run` lists
 * the commands bound to the whole sequence, best first; `chord` says the stroke starts a
 * longer binding, so the next one should be waited for.
 */
export function matchStroke(
  bindings: Map<string, string[]>,
  stroke: string,
  pending: string | null,
): { run: string[]; chord: boolean } {
  const seq = pending ? `${pending} ${stroke}` : stroke;
  const run: string[] = [];
  let chord = false;
  for (const [id, keys] of bindings) {
    for (const k of keys) {
      if (k === seq) run.push(id);
      else if (!pending && k.startsWith(`${seq} `)) chord = true;
    }
  }
  return { run, chord };
}

/** Other commands already answering to `keys`, for warning before it is taken twice. */
export function clashes(id: string, keys: string, overrides: Record<string, string[]> = getPref("keybindings")): string[] {
  const out: string[] = [];
  for (const [other, bound] of allBindings(overrides)) {
    if (other === id) continue;
    // A chord and its own first stroke collide as well: one of them has to wait.
    if (bound.some((k) => k === keys || k.startsWith(`${keys} `) || keys.startsWith(`${k} `))) out.push(other);
  }
  return out;
}

/** Browser and text-field keys a binding would take away from the cells. */
const NATIVE = new Set(["mod+c", "mod+v", "mod+x", "mod+a", "mod+f", "mod+r", "mod+w", "mod+t", "mod+l", "mod+p", "mod+s", "mod+d"]);

export function overridesNative(keys: string): boolean {
  return NATIVE.has(keys.split(" ")[0]);
}

export type Shortcut = { combo: string; what: string };

/** The keys that belong to the grid itself — listed on the sheet, not rebindable. */
export const FIXED_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "In a cell",
    items: [
      { combo: "arrowup", what: "Up a row" },
      { combo: "arrowdown", what: "Down a row" },
      { combo: "enter", what: "Commit and move down" },
      { combo: "arrowleft", what: "Left once the caret is at the edge" },
      { combo: "arrowright", what: "Right once the caret is at the edge" },
      { combo: "tab", what: "Next exercise suggestion" },
      { combo: "shift+tab", what: "Previous one" },
      { combo: "escape", what: "Undo the edit in progress" },
    ],
  },
  {
    title: "Selecting",
    items: [
      { combo: "shift+arrowdown", what: "Grow the selection" },
      { combo: "mod+c", what: "Copy the selected cells or rows" },
      { combo: "mod+v", what: "Paste them from here down" },
      { combo: "mod+d", what: "Fill down" },
      { combo: "backspace", what: "Clear the selected cells" },
    ],
  },
];

/**
 * Bindings used to be kept per default combo (`hotkeys`: "alt+w" → "alt+q", and
 * `disabledHotkeys`). Carries them over to per-command keys once, then drops them.
 */
export function migrateOldHotkeys(): Record<string, string[]> | null {
  let oldMap: Record<string, string> = {};
  let oldOff: string[] = [];
  try {
    const a = localStorage.getItem("topset:hotkeys");
    const b = localStorage.getItem("topset:disabledHotkeys");
    if (a === null && b === null) return null;
    oldMap = a ? (JSON.parse(a) as Record<string, string>) : {};
    oldOff = b ? (JSON.parse(b) as string[]) : [];
    localStorage.removeItem("topset:hotkeys");
    localStorage.removeItem("topset:disabledHotkeys");
  } catch {
    return null;
  }
  const out: Record<string, string[]> = {};
  for (const spec of COMMAND_SPECS) {
    const def = spec.keys?.[0];
    if (!def) continue;
    if (oldOff.includes(def)) out[spec.id] = [];
    else if (oldMap[def]) out[spec.id] = [oldMap[def]];
  }
  return out;
}
