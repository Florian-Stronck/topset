import { weekdayOf } from "@/lib/dates";
import { addDays } from "@/lib/schedule";

/**
 * Check-ins: the questions a coach writes for each athlete, and the athlete's answers.
 * A question is asked daily (on every day, or the weekdays picked) or weekly (it opens on
 * one weekday and stays open to the end of that week). Every answer is stored as text,
 * whatever the kind:
 *
 * - NUMBER  "72.5"
 * - SCALE   "4" — a whole number from the question's min to max; max is the good end
 * - SINGLE  the option picked
 * - MULTI   the options picked, as a JSON array
 * - YESNO   "yes" or "no"
 * - TEXT    the text
 *
 * The scale questions together make the day's readiness: each one read as a share of its
 * range and put back on 1–5, then averaged.
 */

export type CheckinKind = "NUMBER" | "SCALE" | "SINGLE" | "MULTI" | "YESNO" | "TEXT";
export type CheckinCadence = "DAILY" | "WEEKLY";

export const KINDS: CheckinKind[] = ["NUMBER", "SCALE", "SINGLE", "MULTI", "YESNO", "TEXT"];

export type CheckinConfig = {
  /** NUMBER: what it is counted in — "kcal", "h", "L". */
  unit?: string;
  /** SCALE: the ends and what they mean. */
  min?: number;
  max?: number;
  low?: string;
  high?: string;
  /** SINGLE and MULTI. */
  options?: string[];
};

export type CheckinQuestionData = {
  id: string;
  label: string;
  cadence: CheckinCadence;
  /** Weekdays, 0 = Monday. */
  days: number[];
  kind: CheckinKind;
  config: CheckinConfig;
  icon: string;
  color: string;
  order: number;
  archived: boolean;
};

export type CheckinAnswerData = { id: string; questionId: string; day: string; value: string | null };

/** At or under this average, readiness is worth a look. */
export const LOW_READINESS = 2.5;

export const COLORS: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
};

export const colorOf = (name: string) => COLORS[name] ?? COLORS.blue;

/** "0,3" → [0, 3]: weekdays, 0 = Monday. Anything unreadable is dropped. */
export function parseDays(value: string | null | undefined): number[] {
  const parts = (value ?? "").split(",").map((d) => d.trim()).filter((d) => d !== "");
  return [...new Set(parts.map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
}

export function formatDays(days: number[]): string {
  return parseDays(days.join(",")).join(",");
}

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/** A question's settings as stored, cleaned up and with what its kind needs filled in. */
export function parseConfig(kind: CheckinKind, raw: string | CheckinConfig | null | undefined): CheckinConfig {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") obj = parsed;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") obj = raw as Record<string, unknown>;

  if (kind === "NUMBER") {
    const unit = clip(obj.unit, 12);
    return unit ? { unit } : {};
  }
  if (kind === "SCALE") {
    const int = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10 ? (v as number) : d);
    let min = int(obj.min, 1);
    let max = int(obj.max, 5);
    if (max <= min) [min, max] = [1, 5];
    const out: CheckinConfig = { min, max };
    const low = clip(obj.low, 40);
    const high = clip(obj.high, 40);
    if (low) out.low = low;
    if (high) out.high = high;
    return out;
  }
  if (kind === "SINGLE" || kind === "MULTI") {
    const list = Array.isArray(obj.options) ? obj.options : [];
    const options = [...new Set(list.map((o) => clip(o, 40)).filter(Boolean))].slice(0, 20);
    return { options };
  }
  return {};
}

/** A stored question row as the app works with it. */
export function questionData(row: {
  id: string;
  label: string;
  cadence: string;
  days: string;
  kind: string;
  config: string;
  icon: string;
  color: string;
  order: number;
  archived: boolean;
}): CheckinQuestionData {
  const kind = (KINDS.includes(row.kind as CheckinKind) ? row.kind : "TEXT") as CheckinKind;
  return {
    id: row.id,
    label: row.label,
    cadence: row.cadence === "WEEKLY" ? "WEEKLY" : "DAILY",
    days: parseDays(row.days),
    kind,
    config: parseConfig(kind, row.config),
    icon: row.icon,
    color: row.color,
    order: row.order,
    archived: row.archived,
  };
}

/** The weekday a weekly question opens on. */
export const opensOn = (q: Pick<CheckinQuestionData, "days">) => q.days[0] ?? 0;

/**
 * The day an answer to this question is filed under, for a day the athlete is looking at:
 * the day itself for a daily question; for a weekly one, the day it opened that week.
 */
export function answerDay(q: Pick<CheckinQuestionData, "cadence" | "days">, ymd: string): string {
  if (q.cadence === "DAILY") return ymd;
  return addDays(ymd, opensOn(q) - weekdayOf(`${ymd}T00:00:00Z`));
}

/** Whether the question is asked on a `YYYY-MM-DD` day. */
export function asksOn(q: Pick<CheckinQuestionData, "cadence" | "days" | "archived">, ymd: string): boolean {
  if (q.archived) return false;
  const weekday = weekdayOf(`${ymd}T00:00:00Z`);
  if (q.cadence === "WEEKLY") return weekday >= opensOn(q);
  return q.days.length === 0 || q.days.includes(weekday);
}

const NUMBER_LIMIT = 1_000_000;

/**
 * An answer from the app as it is stored, or null for no answer. Anything that doesn't fit
 * the question — a 7 on a 1–5 scale, an option it doesn't offer — is no answer.
 */
export function cleanAnswer(q: Pick<CheckinQuestionData, "kind" | "config">, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  switch (q.kind) {
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
      if (String(raw).trim() === "" || !Number.isFinite(n) || Math.abs(n) > NUMBER_LIMIT) return null;
      return String(Math.round(n * 100) / 100);
    }
    case "SCALE": {
      const n = Number(raw);
      const { min = 1, max = 5 } = q.config;
      return Number.isInteger(n) && n >= min && n <= max ? String(n) : null;
    }
    case "SINGLE": {
      const s = String(raw);
      return (q.config.options ?? []).includes(s) ? s : null;
    }
    case "MULTI": {
      let list: unknown = raw;
      if (typeof raw === "string") {
        try {
          list = JSON.parse(raw);
        } catch {
          return null;
        }
      }
      if (!Array.isArray(list)) return null;
      const options = q.config.options ?? [];
      const picked = options.filter((o) => list.includes(o));
      return picked.length ? JSON.stringify(picked) : null;
    }
    case "YESNO":
      return raw === true || raw === "yes" ? "yes" : raw === false || raw === "no" ? "no" : null;
    case "TEXT": {
      const s = String(raw).trim().slice(0, 1000);
      return s || null;
    }
  }
}

/** The options picked on a MULTI answer. */
export function picked(value: string | null): string[] {
  if (!value) return [];
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** An answer as a few words: "4/5", "8,500 steps", "Creatine, Caffeine", "Yes". */
export function formatAnswer(
  q: Pick<CheckinQuestionData, "kind" | "config">,
  value: string | null,
  yesNo: { yes: string; no: string } = { yes: "Yes", no: "No" },
): string {
  if (value === null) return "—";
  switch (q.kind) {
    case "NUMBER":
      return q.config.unit ? `${value} ${q.config.unit}` : value;
    case "SCALE":
      return `${value}/${q.config.max ?? 5}`;
    case "MULTI":
      return picked(value).join(", ") || "—";
    case "YESNO":
      return value === "yes" ? yesNo.yes : yesNo.no;
    default:
      return value;
  }
}

/** A scale answer on 1–5, the good end high, to one decimal. Null for any other kind. */
export function scaleScore(q: Pick<CheckinQuestionData, "kind" | "config">, value: string | null): number | null {
  if (q.kind !== "SCALE" || value === null) return null;
  const n = Number(value);
  const { min = 1, max = 5 } = q.config;
  if (!Number.isFinite(n) || max <= min) return null;
  const share = Math.min(1, Math.max(0, (n - min) / (max - min)));
  return Math.round((1 + share * 4) * 10) / 10;
}

export type DayReadiness = {
  /** The scale answers averaged on 1–5, null when none were answered. */
  score: number | null;
  /** The scale answers at 2 or under on that 1–5 reading. */
  low: { label: string; value: string }[];
};

/** The day's readiness from its scale answers. */
export function readinessOf(questions: CheckinQuestionData[], answers: CheckinAnswerData[]): DayReadiness {
  const scores: number[] = [];
  const low: DayReadiness["low"] = [];
  for (const a of answers) {
    const q = questions.find((x) => x.id === a.questionId);
    if (!q) continue;
    const s = scaleScore(q, a.value);
    if (s === null) continue;
    scores.push(s);
    if (s <= 2) low.push({ label: q.label, value: formatAnswer(q, a.value) });
  }
  if (scores.length === 0) return { score: null, low };
  return { score: Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10) / 10, low };
}

export type ReadinessDay = DayReadiness & {
  day: string;
  /** The text answers given that day. */
  notes: string[];
};

/** The latest day with a scale answer: its readiness, and whatever the athlete wrote that day. */
export function latestReadiness(questions: CheckinQuestionData[], answers: CheckinAnswerData[]): ReadinessDay | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const days = [...new Set(answers.filter((a) => byId.get(a.questionId)?.kind === "SCALE").map((a) => a.day))].sort();
  const day = days.at(-1);
  if (!day) return null;
  const that = answers.filter((a) => a.day === day);
  const notes = that.filter((a) => byId.get(a.questionId)?.kind === "TEXT" && a.value).map((a) => a.value as string);
  return { day, notes, ...readinessOf(questions, that) };
}

export type Preset = {
  key: string;
  label: string;
  kind: CheckinKind;
  config: CheckinConfig;
  icon: string;
  color: string;
};

/** Questions a coach can start from; every field stays editable. Labels are translated when picked. */
export const PRESETS: Preset[] = [
  { key: "calories", label: "Calories", kind: "NUMBER", config: { unit: "kcal" }, icon: "flame", color: "orange" },
  { key: "sleep", label: "Sleep", kind: "NUMBER", config: { unit: "h" }, icon: "moon", color: "blue" },
  { key: "sleep-quality", label: "Sleep quality", kind: "SCALE", config: { min: 1, max: 5, low: "Poor", high: "Great" }, icon: "bed", color: "blue" },
  { key: "stress", label: "Stress", kind: "SCALE", config: { min: 1, max: 5, low: "Very stressed", high: "Relaxed" }, icon: "gauge", color: "orange" },
  { key: "soreness", label: "Soreness", kind: "SCALE", config: { min: 1, max: 5, low: "Very sore", high: "Fresh" }, icon: "bandage", color: "red" },
  { key: "energy", label: "Energy", kind: "SCALE", config: { min: 1, max: 5, low: "Flat", high: "Ready to go" }, icon: "zap", color: "amber" },
  { key: "steps", label: "Steps", kind: "NUMBER", config: { unit: "steps" }, icon: "footprints", color: "green" },
  { key: "water", label: "Water", kind: "NUMBER", config: { unit: "L" }, icon: "droplet", color: "teal" },
  {
    key: "cycle",
    label: "Cycle",
    kind: "SINGLE",
    config: { options: ["Period", "Follicular", "Ovulation", "Luteal"] },
    icon: "venus",
    color: "pink",
  },
  {
    key: "supplements",
    label: "Supplements",
    kind: "MULTI",
    config: { options: ["Creatine", "Protein", "Caffeine", "Vitamin D"] },
    icon: "pill",
    color: "purple",
  },
  { key: "notes", label: "Notes", kind: "TEXT", config: {}, icon: "note", color: "purple" },
];
