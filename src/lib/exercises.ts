import type { Tier } from "@prisma/client";
import { liftOf } from "@/lib/intensity";
import { activeSettings, type CoachSettings } from "@/lib/settings";

export type CatalogEntry = { name: string; target: string; tier: Tier };

/**
 * Seeds the EXERCISE autocomplete and, more importantly, pins down the TARGET and
 * tier for names the heuristics below would read wrong (an RDL is a deadlift by
 * name but not a competition deadlift).
 */
export const EXERCISE_CATALOG: CatalogEntry[] = [
  { name: "Back Squat", target: "Squat", tier: "PRIMARY" },
  { name: "Competition Squat", target: "Squat", tier: "PRIMARY" },
  { name: "High Bar Squat", target: "Squat", tier: "VARIATION" },
  { name: "Front Squat", target: "Squat", tier: "VARIATION" },
  { name: "Paused Squat", target: "Squat", tier: "VARIATION" },
  { name: "Tempo Squat", target: "Squat", tier: "VARIATION" },
  { name: "Pin Squat", target: "Squat", tier: "VARIATION" },
  { name: "Box Squat", target: "Squat", tier: "VARIATION" },
  { name: "Safety Bar Squat", target: "Squat", tier: "VARIATION" },
  { name: "Bulgarian Split Squat", target: "General", tier: "ACCESSORY" },
  { name: "Goblet Squat", target: "General", tier: "ACCESSORY" },
  { name: "Hack Squat", target: "General", tier: "ACCESSORY" },
  { name: "Leg Press", target: "General", tier: "ACCESSORY" },
  { name: "Leg Extension", target: "General", tier: "ACCESSORY" },
  { name: "Leg Curl", target: "General", tier: "ACCESSORY" },
  { name: "Walking Lunge", target: "General", tier: "ACCESSORY" },

  { name: "Bench Press", target: "Bench", tier: "PRIMARY" },
  { name: "Competition Bench", target: "Bench", tier: "PRIMARY" },
  { name: "Paused Bench", target: "Bench", tier: "VARIATION" },
  { name: "Close Grip Bench", target: "Bench", tier: "VARIATION" },
  { name: "Wide Grip Bench", target: "Bench", tier: "VARIATION" },
  { name: "Spoto Press", target: "Bench", tier: "VARIATION" },
  { name: "Larsen Press", target: "Bench", tier: "VARIATION" },
  { name: "Board Press", target: "Bench", tier: "VARIATION" },
  { name: "Pin Press", target: "Bench", tier: "VARIATION" },
  { name: "Incline Bench", target: "General", tier: "ACCESSORY" },
  { name: "Overhead Press", target: "General", tier: "ACCESSORY" },
  { name: "Dumbbell Press", target: "General", tier: "ACCESSORY" },
  { name: "Dip", target: "General", tier: "ACCESSORY" },
  { name: "Triceps Pushdown", target: "General", tier: "ACCESSORY" },
  { name: "Skullcrusher", target: "General", tier: "ACCESSORY" },
  { name: "Lateral Raise", target: "General", tier: "ACCESSORY" },

  { name: "Deadlift", target: "Deadlift", tier: "PRIMARY" },
  { name: "Competition Deadlift", target: "Deadlift", tier: "PRIMARY" },
  { name: "Sumo Deadlift", target: "Deadlift", tier: "PRIMARY" },
  { name: "Conventional Deadlift", target: "Deadlift", tier: "PRIMARY" },
  { name: "Deficit Deadlift", target: "Deadlift", tier: "VARIATION" },
  { name: "Block Pull", target: "Deadlift", tier: "VARIATION" },
  { name: "Paused Deadlift", target: "Deadlift", tier: "VARIATION" },
  { name: "Snatch Grip Deadlift", target: "Deadlift", tier: "VARIATION" },
  { name: "Romanian Deadlift", target: "General", tier: "ACCESSORY" },
  { name: "Stiff Leg Deadlift", target: "General", tier: "ACCESSORY" },
  { name: "Good Morning", target: "General", tier: "ACCESSORY" },
  { name: "Hip Thrust", target: "General", tier: "ACCESSORY" },
  { name: "Back Extension", target: "General", tier: "ACCESSORY" },

  { name: "Barbell Row", target: "General", tier: "ACCESSORY" },
  { name: "Pendlay Row", target: "General", tier: "ACCESSORY" },
  { name: "Chest Supported Row", target: "General", tier: "ACCESSORY" },
  { name: "Lat Pulldown", target: "General", tier: "ACCESSORY" },
  { name: "Pull Up", target: "General", tier: "ACCESSORY" },
  { name: "Face Pull", target: "General", tier: "ACCESSORY" },
  { name: "Barbell Curl", target: "General", tier: "ACCESSORY" },
  { name: "Hammer Curl", target: "General", tier: "ACCESSORY" },
  { name: "Plank", target: "General", tier: "ACCESSORY" },
  { name: "Hanging Leg Raise", target: "General", tier: "ACCESSORY" },
];

type Library = {
  entries: CatalogEntry[];
  byKey: Map<string, CatalogEntry>;
  /** Alias key → the exercise's name. */
  aliases: Map<string, string>;
  hidden: Set<string>;
};

let cached: { settings: CoachSettings; library: Library } | null = null;

/**
 * The coach's exercise library: the built-in catalog minus what they hid, with their own
 * exercises added — one with a built-in's name replaces it, which is how a built-in's
 * target or tier gets changed.
 */
export function library(): Library {
  const settings = activeSettings();
  if (cached?.settings === settings) return cached.library;

  const hidden = new Set(settings.hiddenExercises.map(key));
  const byKey = new Map<string, CatalogEntry>();
  for (const e of EXERCISE_CATALOG) if (!hidden.has(key(e.name))) byKey.set(key(e.name), e);
  const aliases = new Map<string, string>();
  for (const e of settings.customExercises) {
    if (!e.name.trim()) continue;
    byKey.set(key(e.name), { name: e.name, target: e.target, tier: e.tier });
    for (const a of e.aliases) if (key(a)) aliases.set(key(a), e.name);
  }

  const lib = { entries: [...byKey.values()], byKey, aliases, hidden };
  cached = { settings, library: lib };
  return lib;
}

/** The exercise an alias stands for ("SSB" → "Safety Bar Squat"), or the name as typed. */
export function resolveAlias(name: string): string {
  return library().aliases.get(key(name)) ?? name;
}

/** Words that turn a main lift into a variation trained off a lower max. */
const VARIATION_WORDS = [
  "paused", "pause", "pin", "pins", "deficit", "tempo", "spoto", "larsen", "board",
  "block", "blocks", "box", "front", "high", "close", "grip", "banded", "bands",
  "chain", "chains", "slingshot", "feet", "ssb", "safety", "touch", "anderson", "duffalo",
];

/** Words that keep a row an accessory even when a main lift's name is in there. */
const ACCESSORY_WORDS = [
  "romanian", "rdl", "stiff", "snatch", "dumbbell", "db", "goblet", "hack", "split",
  "bulgarian", "belt", "zercher", "landmine", "machine", "smith", "single", "leg",
  "good", "morning", "hyper", "extension", "curl",
];

function key(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function words(name: string) {
  return new Set(key(name).split(" ").filter(Boolean));
}

/**
 * Derives TARGET and tier from an exercise name. The catalog wins outright; anything
 * else falls back to the same lift matching the TARGET column already uses, narrowed
 * by variation/accessory hints in the name.
 */
/** "Backoff", "Back-off sets", "squat back off" — a lighter follow-up to the lift above. */
export function isBackoff(name: string): boolean {
  return /back\s*-?\s*off/i.test(name);
}

export function classifyExercise(name: string): { target: string; tier: Tier } {
  const exact = library().byKey.get(key(resolveAlias(name)));
  if (exact) return { target: exact.target, tier: exact.tier };

  const lift = liftOf(name);
  if (lift === null) return { target: "General", tier: "ACCESSORY" };

  const target = lift === "squat" ? "Squat" : lift === "bench" ? "Bench" : "Deadlift";
  const w = words(name);

  if (ACCESSORY_WORDS.some((a) => w.has(a))) return { target: "General", tier: "ACCESSORY" };
  if (VARIATION_WORDS.some((v) => w.has(v))) return { target, tier: "VARIATION" };
  return { target, tier: "PRIMARY" };
}

/**
 * Names matching `query`, prefix matches first so the inline completion has something
 * to extend. `history` (names the coach already used) outranks the built-in catalog.
 */
export function suggestExercises(query: string, history: string[], limit = 8): string[] {
  const lib = library();
  const pool: string[] = [];
  const seen = new Set<string>();
  for (const name of [...history, ...lib.entries.map((e) => e.name)]) {
    const k = key(name);
    if (k === "" || seen.has(k) || lib.hidden.has(k)) continue;
    seen.add(k);
    pool.push(name);
  }

  const q = key(query);
  if (q === "") return pool.slice(0, limit);

  // An alias typed in full or in part offers the exercise it stands for.
  const viaAlias = [...lib.aliases].filter(([a]) => a.startsWith(q)).map(([, name]) => name);
  const prefix = pool.filter((n) => key(n).startsWith(q));
  const inner = pool.filter((n) => !key(n).startsWith(q) && key(n).includes(q));
  return [...new Set([...viaAlias, ...prefix, ...inner])].slice(0, limit);
}

/** The rest of the best prefix match, for the greyed completion inside the input. */
export function completionFor(query: string, history: string[]): string {
  if (query.trim() === "") return "";
  const [best] = suggestExercises(query, history, 1);
  // Sliced off the raw name, so only a literal prefix can extend what is typed.
  if (!best || !best.toLowerCase().startsWith(query.toLowerCase())) return "";
  return best.slice(query.length);
}
