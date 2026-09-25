import type { IntensityType, MeetLift, Tier, Unit } from "@prisma/client";
import { cache } from "react";
import { t } from "@/lib/i18n";

/**
 * Everything a coach can set that travels with their data — stored as JSON on the Coach
 * row, so a backup carries it and a restore brings it back. How the screen looks on one
 * particular computer lives in `prefs.ts` instead.
 *
 * Stored settings are partial: whatever the coach never touched falls back to DEFAULTS,
 * so adding a setting later never needs a migration.
 */

export type E1rmFormula = "rpe" | "epley" | "brzycki";
export type DayNaming = "session" | "day" | "weekday";
export type DateFormat = "d-mmm" | "dd/mm" | "mm/dd";
export type StartScreen = "overview" | "programming" | "last";
export type Language = "en" | "de" | "fr" | "lb";
export type ExportKind = "xlsx" | "pdf" | "print" | "csv" | "repwise" | "repwise-tsv";
export type ProgField = "SETS" | "REPS" | "INTENSITY";

export type ProgressionPreset = {
  label: string;
  field: ProgField;
  op: "ADD" | "MULTIPLY";
  amount: number;
  everyWeeks: number;
  startWeek: number;
  /** null runs to the end of the phase. */
  endWeek: number | null;
};

export type RpeTable = {
  /** Row headings, e.g. 10, 9.5 … 7. */
  rpe: number[];
  /** Column headings, e.g. 1 … 10. */
  reps: number[];
  /** pct[row][column], % of 1RM. */
  pct: number[][];
};

export type CustomExercise = {
  name: string;
  target: string;
  tier: Tier;
  /** Other names typed for it, e.g. "SSB" for Safety Bar Squat. */
  aliases: string[];
};

export type CoachSettings = {
  // Units and numbers
  defaultUnit: Unit;
  roundKg: number;
  roundLb: number;
  e1rmFormula: E1rmFormula;
  /**
   * %1RM by RPE (rows) and reps (columns), used for RPE loads and the "rpe" estimate.
   * Anything off the grid is read from the same curve by reps to failure.
   */
  rpeTable: RpeTable;
  /** Decimals shown for percentages and RPE. */
  decimals: number;

  // Programming defaults
  newRow: {
    tier: Tier;
    target: string;
    sets: number;
    reps: number;
    intensityType: IntensityType;
    intensity: number;
  };
  programWeeks: number;
  phaseWeeks: number;
  /** Names given to a program's phases in order; the last repeats. */
  phaseNames: string[];
  /** Weekday indexes (0 = Monday) that train in a new program. */
  trainingDays: number[];
  dayNaming: DayNaming;
  restName: string;
  tiers: Record<Tier, { label: string; show: boolean }>;
  targets: string[];
  progressionPresets: ProgressionPreset[];
  /** An edit in one week is made in every other unlocked week of the phase too. */
  syncWeeks: boolean;
  /** 0 = Monday … 6 = Sunday. */
  weekStart: number;
  /** Snap program and phase start dates to `weekStart`. */
  snapStart: boolean;

  // Exercises
  customExercises: CustomExercise[];
  hiddenExercises: string[];

  // Dates and app
  dateFormat: DateFormat;
  startScreen: StartScreen;
  language: Language;
  showTutorial: boolean;

  // Exports and print
  branding: { name: string; logo: string | null; header: string; footer: string };
  exportColumns: { progression: boolean; notes: boolean; tempo: boolean; rest: boolean; video: boolean };
  paper: "A4" | "LETTER";
  orientation: "portrait" | "landscape";
  logBoxes: number;
  defaultExport: ExportKind;
  /** {athlete} {program} {phase} {date} are filled in. */
  fileName: string;

  // Tracking and competition
  totalLifts: MeetLift[];
  attemptShare: { 1: number; 2: number; 3: number };
  pr: { basis: "e1rm" | "weight"; highlight: boolean };
  needsProgramWeeks: number;

  // Data
  backup: { enabled: boolean; everyDays: number; keep: number; folder: string | null };
  /** Where the hosted athlete app lives, e.g. https://topset-yourname.vercel.app — the start of every athlete link. */
  athleteAppUrl: string;
  undoLimit: number;
};

export const DEFAULTS: CoachSettings = {
  defaultUnit: "KG",
  roundKg: 2.5,
  roundLb: 5,
  e1rmFormula: "rpe",
  rpeTable: {
    rpe: [10, 9.5, 9, 8.5, 8, 7.5, 7],
    reps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    pct: [
      [100, 96, 92, 89, 86, 84, 81, 79, 76, 74],
      [98, 94, 91, 88, 85, 82, 80, 77, 75, 72],
      [96, 92, 89, 86, 84, 81, 79, 76, 74, 71],
      [94, 91, 88, 85, 82, 80, 77, 75, 72, 69],
      [92, 89, 86, 84, 81, 79, 76, 74, 71, 68],
      [91, 88, 85, 82, 80, 77, 75, 72, 69, 67],
      [89, 86, 84, 81, 79, 76, 74, 71, 68, 65],
    ],
  },
  decimals: 1,

  newRow: { tier: "ACCESSORY", target: "General", sets: 3, reps: 8, intensityType: "RPE", intensity: 7 },
  programWeeks: 4,
  phaseWeeks: 4,
  phaseNames: ["Volume", "Strength", "Peaking"],
  trainingDays: [0, 2, 4],
  dayNaming: "session",
  restName: "Rest",
  tiers: {
    PRIMARY: { label: "Primary", show: true },
    SECONDARY: { label: "Secondary", show: true },
    VARIATION: { label: "Variation", show: true },
    BACKOFF: { label: "Backoff", show: true },
    ACCESSORY: { label: "Accessory", show: true },
  },
  targets: ["Squat", "Bench", "Deadlift", "General", "Quadriceps", "Hamstrings", "Glutes", "Back", "Chest", "Shoulders", "Arms", "Core"],
  progressionPresets: [
    { label: "+1 rep / week", field: "REPS", op: "ADD", amount: 1, everyWeeks: 1, startWeek: 2, endWeek: null },
    { label: "+0.5 RPE / week", field: "INTENSITY", op: "ADD", amount: 0.5, everyWeeks: 1, startWeek: 2, endWeek: null },
    { label: "+2.5 / week", field: "INTENSITY", op: "ADD", amount: 2.5, everyWeeks: 1, startWeek: 2, endWeek: null },
    { label: "+1 set every 2 weeks", field: "SETS", op: "ADD", amount: 1, everyWeeks: 2, startWeek: 2, endWeek: null },
    { label: "Deload: −40% sets, last week", field: "SETS", op: "MULTIPLY", amount: 0.6, everyWeeks: 1, startWeek: 4, endWeek: 4 },
  ],
  syncWeeks: true,
  weekStart: 0,
  snapStart: true,

  customExercises: [],
  hiddenExercises: [],

  dateFormat: "d-mmm",
  startScreen: "programming",
  language: "en",
  showTutorial: true,

  branding: { name: "", logo: null, header: "", footer: "" },
  exportColumns: { progression: true, notes: true, tempo: true, rest: true, video: false },
  paper: "A4",
  orientation: "portrait",
  logBoxes: 1,
  defaultExport: "xlsx",
  fileName: "{athlete} - {program} - {phase}",

  totalLifts: ["SQUAT", "BENCH", "DEADLIFT"],
  attemptShare: { 1: 0.9, 2: 0.955, 3: 1 },
  pr: { basis: "e1rm", highlight: true },
  needsProgramWeeks: 2,

  backup: { enabled: true, everyDays: 1, keep: 14, folder: null },
  athleteAppUrl: "",
  undoLimit: 100,
};

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

/** Stored values over the defaults, object by object; arrays and scalars replace outright. */
export function mergeSettings<T>(base: T, over: unknown): T {
  if (!isPlain(base) || !isPlain(over)) return (over === undefined ? base : (over as T));
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = k in base ? mergeSettings((base as Plain)[k], v) : v;
  }
  return out as T;
}

/** What the browser gets in place of the logo itself; the image is served by /api/logo. */
export const LOGO_STORED = "stored";

/** The settings as sent to every page — the same, minus the logo's bytes. */
export function forClient(settings: CoachSettings): CoachSettings {
  if (!settings.branding.logo) return settings;
  return { ...settings, branding: { ...settings.branding, logo: LOGO_STORED } };
}

export function parseSettings(json: string | null | undefined): CoachSettings {
  try {
    return mergeSettings(DEFAULTS, json ? JSON.parse(json) : {});
  } catch {
    return DEFAULTS;
  }
}

export type SettingsPatch = { [K in keyof CoachSettings]?: CoachSettings[K] extends object ? Partial<CoachSettings[K]> | CoachSettings[K] : CoachSettings[K] };

/*
 * The settings in force right now, for the pure helpers (rounding, estimates, dates)
 * that are called from both sides and shouldn't need a settings argument threaded
 * through every caller. Topset is one coach per install, so one value is enough: the server
 * sets it when it reads the coach, the browser when the provider renders.
 */
let active: CoachSettings = DEFAULTS;

export function setActiveSettings(settings: CoachSettings) {
  active = settings;
}

/**
 * On the Topset server one process answers for many coaches at once, so the settings of the
 * coach a page is for live in a slot that belongs to that one request (React's `cache` is
 * per request while server components render) rather than in the shared value above.
 */
const requestSlot = cache((): { settings: CoachSettings | null } => ({ settings: null }));

export function setRequestSettings(settings: CoachSettings) {
  if (typeof window === "undefined") requestSlot().settings = settings;
}

export function activeSettings(): CoachSettings {
  if (typeof window === "undefined") {
    const own = requestSlot().settings;
    if (own) return own;
  }
  return active;
}

export const TIERS: Tier[] = ["PRIMARY", "SECONDARY", "VARIATION", "BACKOFF", "ACCESSORY"];

/** What the coach calls a tier — the built-in names in their language, their own as typed. */
export function tierLabel(tier: Tier): string {
  const own = active.tiers[tier]?.label;
  if (!own || own === DEFAULTS.tiers[tier].label) return t(DEFAULTS.tiers[tier].label);
  return own;
}

/** The name the n-th phase of a program gets (0-based), translated while it is a default. */
export function phaseName(n: number): string {
  const own = active.phaseNames[n];
  if (!own) return t("Phase {n}", { n: n + 1 });
  return DEFAULTS.phaseNames.includes(own) ? t(own) : own;
}
