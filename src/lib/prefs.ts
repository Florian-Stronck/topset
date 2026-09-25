"use client";

import type { Tier } from "@prisma/client";
import { useSyncExternalStore } from "react";

/**
 * Per-computer view preferences, kept in localStorage — how the screen looks here, as
 * opposed to the coach's settings in `settings.ts`, which travel with the data. Every
 * component reading a pref re-renders when any of them changes it, in this tab or another.
 */

const EVENT = "topset:prefs";

export type Column = "progression" | "notes" | "tempo" | "rest" | "video";

export type Prefs = {
  /** Intensity sits right next to reps instead of stretching across the week. */
  tightIntensity: boolean;
  density: "comfortable" | "compact";
  columns: Record<Column, boolean>;
  hideRestDays: boolean;
  sidebarCollapsed: boolean;
  /** What the intensity cell shows: the weight, the prescription, or both. */
  cellDisplay: "both" | "weight" | "intensity";
  fontSize: "small" | "medium" | "large";
  theme: "dark" | "light";
  accent: string;
  tierColors: { PRIMARY: string; SECONDARY: string; VARIATION: string; BACKOFF: string; ACCESSORY: string };
  /**
   * A colour per target ("Squat" → blue): its rows are tinted and badged with it on the
   * sheet. An empty string switches a default one off.
   */
  targetColors: Record<string, string>;
  /**
   * Command id → the keys it answers to, for every command the coach rebound. An empty
   * list switches its default off; a missing id keeps the default.
   */
  keybindings: Record<string, string[]>;
  /** Titles of bound commands that aren't built in ("Switch to Anna"), for the settings list. */
  keybindingTitles: Record<string, string>;
  /** Command ids listed first in the palette. */
  pinnedCommands: string[];
  /** The palette's most recently run commands, newest first. */
  recentCommands: string[];
  /** A copied phase or week, waiting to be pasted — into any program, any athlete. */
  clipboard: { kind: "phase" | "week"; id: string; label: string } | null;
  /** How Tracking is filtered and charted on this computer. */
  tracking: TrackingPrefs;
};

export type TrackingPrefs = {
  filter: "all" | "unreviewed" | "offplan" | "missed" | "prs";
  lifts: "all" | "main" | "variations" | "accessories";
  /** Every exercise opened to its sets. */
  expandAll: boolean;
  /** Sessions later this week, not just the ones done or due. */
  showUpcoming: boolean;
  /** Coach notes, tempo and rest under each exercise. */
  showCues: boolean;
  /** Fetch what athletes logged every minute while Tracking is open. */
  autoSync: boolean;
  chartBasis: "estimated" | "prescribed";
  chartRange: "phase" | "program" | "12w" | "all";
  /** Lifts switched off in the charts. */
  chartHidden: ("squat" | "bench" | "dead")[];
  tonnageBy: "lift" | "target";
  /** Which lift the RPE, zones and week-by-week charts show. */
  chartLift: "all" | "squat" | "bench" | "dead";
  checkinRange: 14 | 28 | 56;
  lowOnly: boolean;
  /** Readiness as one score, or a line per question. */
  perQuestion: boolean;
};

export const PREF_DEFAULTS: Prefs = {
  tightIntensity: false,
  density: "comfortable",
  columns: { progression: true, notes: true, tempo: false, rest: false, video: false },
  hideRestDays: false,
  sidebarCollapsed: false,
  cellDisplay: "both",
  fontSize: "medium",
  theme: "dark",
  accent: "#e5365a",
  tierColors: { PRIMARY: "#e5365a", SECONDARY: "#c98bb0", VARIATION: "#8ab4c9", BACKOFF: "#6f8a99", ACCESSORY: "#7a7a88" },
  targetColors: { Squat: "#3b82f6", Bench: "#22c55e", Deadlift: "#e5365a" },
  keybindings: {},
  keybindingTitles: {},
  pinnedCommands: [],
  recentCommands: [],
  clipboard: null,
  tracking: {
    filter: "all",
    lifts: "all",
    expandAll: false,
    showUpcoming: true,
    showCues: false,
    autoSync: true,
    chartBasis: "estimated",
    chartRange: "all",
    chartHidden: [],
    tonnageBy: "lift",
    chartLift: "squat",
    checkinRange: 14,
    lowOnly: false,
    perQuestion: false,
  },
};

/** Changes some of Tracking's view settings, keeping the rest. */
export function setTrackingPref(patch: Partial<TrackingPrefs>) {
  setPref("tracking", { ...read("tracking"), ...patch });
}

// Snapshots must be stable between changes, or useSyncExternalStore re-renders forever.
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<K extends keyof Prefs>(key: K): Prefs[K] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(`topset:${key}`);
  } catch {}
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as Prefs[K];

  let value: Prefs[K] = PREF_DEFAULTS[key];
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Prefs[K];
      const base = PREF_DEFAULTS[key];
      value =
        typeof base === "object" && base !== null && !Array.isArray(base)
          ? ({ ...base, ...(parsed as object) } as Prefs[K])
          : parsed;
    } catch {}
  }
  cache.set(key, { raw, value });
  return value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  return useSyncExternalStore(subscribe, () => read(key), () => PREF_DEFAULTS[key]);
}

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return typeof window === "undefined" ? PREF_DEFAULTS[key] : read(key);
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  try {
      localStorage.setItem(`topset:${key}`, JSON.stringify(value));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function resetPref(key: keyof Prefs) {
  try {
      localStorage.removeItem(`topset:${key}`);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

type BooleanPref = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];

export function togglePref(key: BooleanPref) {
  setPref(key, !read(key));
}

/**
 * How much of a target's colour each tier shows: the main lift in full, the lifts built
 * around it progressively quieter, down to its back-off sets.
 */
export const TIER_STRENGTH: Record<Tier, number> = {
  PRIMARY: 100,
  SECONDARY: 78,
  VARIATION: 62,
  BACKOFF: 48,
  ACCESSORY: 100,
};

/** A target's colour as a tier wears it — see TIER_STRENGTH. */
export function tierShade(color: string, tier: Tier): string {
  const strength = TIER_STRENGTH[tier];
  return strength >= 100 ? color : `color-mix(in srgb, ${color} ${strength}%, var(--surface))`;
}

/** The colour a target is shown in, matched however it was typed; null when it has none. */
export function colorOfTarget(colors: Record<string, string>, target: string): string | null {
  const key = target.trim().toLowerCase();
  for (const [name, color] of Object.entries(colors)) {
    if (name.trim().toLowerCase() === key) return color || null;
  }
  return null;
}
