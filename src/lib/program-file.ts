import type { IntensityType, ProgField, ProgOp, Tier } from "@prisma/client";

/**
 * The `.topset.json` interchange format: one program and all of its phases, prescription
 * only. Logged weights, performed RPEs and athlete notes never travel — a program is a
 * plan, not someone else's history — and neither does any id, so an import is always new.
 *
 * Version 3 writes every week out whole, with its lock: weeks own their sessions, so a
 * locked deload can have rows, days and names the other weeks don't. Version 2 described
 * a phase as week 1's days with a cell per week, and version 1 held a single phase at the
 * top level; both still read.
 */
export const PROGRAM_FILE_VERSION = 3;

export type ProgramRule = {
  order: number;
  field: ProgField;
  op: ProgOp;
  amount: number;
  everyWeeks: number;
  startWeek: number;
  endWeek: number | null;
  enabled: boolean;
};

/** What a row prescribes for its week. */
export type Prescription = {
  sets: number | null;
  reps: number | null;
  intensityType: IntensityType;
  intensity: number | null;
  intensityMax: number | null;
  rampStep: number | null;
  coachNotes: string | null;
  tempo: string | null;
  restTime: string | null;
  videoUrl: string | null;
};

export type ProgramRow = Prescription & {
  order: number;
  tier: Tier;
  target: string;
  exercise: string;
  rules: ProgramRule[];
};

export type ProgramDay = {
  index: number;
  label: string;
  rest: boolean;
  rows: ProgramRow[];
};

export type ProgramWeek = {
  week: number;
  /** A locked week keeps its own content: progressions and week syncing pass it by. */
  locked: boolean;
  days: ProgramDay[];
};

export type ProgramPhase = {
  phase: string;
  startDate: string;
  squat1RM: number | null;
  bench1RM: number | null;
  dead1RM: number | null;
  weeks: ProgramWeek[];
};

export type ProgramFile = {
  topset: number;
  name: string;
  phases: ProgramPhase[];
};

// Bounds, so a malformed or hostile file cannot ask for a million rows.
const LIMITS = {
  weeks: 52,
  days: 14,
  rowsPerDay: 200,
  cellsPerRow: 52,
  rulesPerRow: 20,
  phases: 40,
  text: 200,
  notes: 2000,
};

const TIERS: Tier[] = ["PRIMARY", "SECONDARY", "VARIATION", "BACKOFF", "ACCESSORY"];
const INTENSITY_TYPES: IntensityType[] = [
  "RPE",
  "RIR",
  "PERCENT",
  "WEIGHT",
  "RANGE",
  "BACKOFF",
];
const FIELDS: ProgField[] = ["SETS", "REPS", "INTENSITY"];
const OPS: ProgOp[] = ["ADD", "MULTIPLY"];

type SourcePhase = {
  phase: string;
  startDate: Date;
  squat1RM: number | null;
  bench1RM: number | null;
  dead1RM: number | null;
  weeks: {
    order: number;
    locked: boolean;
    days: { index: number; label: string; rest: boolean; rows: ProgramRow[] }[];
  }[];
};

type SourceProgram = { name: string; phases: SourcePhase[] };

export function toProgramFile(program: SourceProgram): ProgramFile {
  return {
    topset: PROGRAM_FILE_VERSION,
    name: program.name,
    phases: program.phases.map(toPhase),
  };
}

function toPhase(block: SourcePhase): ProgramPhase {
  return {
    phase: block.phase,
    startDate: block.startDate.toISOString().slice(0, 10),
    squat1RM: block.squat1RM,
    bench1RM: block.bench1RM,
    dead1RM: block.dead1RM,
    weeks: block.weeks.map((week) => ({
      week: week.order,
      locked: week.locked,
      days: week.days.map((day) => ({
        index: day.index,
        label: day.label,
        rest: day.rest,
        rows: day.rows.map((row) => ({
          order: row.order,
          tier: row.tier,
          target: row.target,
          exercise: row.exercise,
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
        })),
      })),
    })),
  };
}

class ProgramFileError extends Error {}

function fail(message: string): never {
  throw new ProgramFileError(message);
}

function obj(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string, limit: number): unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not a list`);
  if (value.length > limit) fail(`${what} has more than ${limit} entries`);
  return value;
}

function text(value: unknown, what: string, limit = LIMITS.text): string {
  if (typeof value !== "string") fail(`${what} is not text`);
  return value.slice(0, limit);
}

function optionalText(value: unknown, what: string, limit = LIMITS.text): string | null {
  if (value === null || value === undefined) return null;
  return text(value, what, limit);
}

function num(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${what} is not a number`);
  return Math.min(max, Math.max(min, value));
}

function optionalNum(
  value: unknown,
  what: string,
  min: number,
  max: number,
): number | null {
  if (value === null || value === undefined) return null;
  return num(value, what, min, max);
}

function pick<T extends string>(value: unknown, allowed: T[], what: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${what} is not one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function date(value: unknown, what: string): string {
  const raw = text(value, what, 40);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) fail(`${what} is not a date`);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Reads a file someone was handed. Everything is checked rather than trusted: unknown
 * enum values, absurd counts and wrong types are rejected with a message a coach can
 * act on, and anything the format doesn't define is dropped.
 */
export function parseProgramFile(raw: string): ProgramFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("That file isn't JSON.");
  }

  const root = obj(parsed, "The file");
  const version = root.topset;
  if (version !== 1 && version !== 2 && version !== 3) {
    fail(`This is not a Topset program file (expected "topset": ${PROGRAM_FILE_VERSION}).`);
  }

  // A version 1 file is the phase itself; later versions carry a list of them.
  const phases = version === 1 ? [root] : list(root.phases, "phases", LIMITS.phases);
  const read = version === 3 ? parsePhase : parseLegacyPhase;

  return {
    topset: PROGRAM_FILE_VERSION,
    name: text(root.name, "name"),
    phases: phases.map((entry, i) => read(obj(entry, `phase ${i + 1}`), i)),
  };
}

function parseRule(value: unknown, i: number, where: string): ProgramRule {
  const rule = obj(value, `${where} rule ${i + 1}`);
  return {
    order: Math.round(num(rule.order ?? i, `${where} rule order`, 0, LIMITS.rulesPerRow)),
    field: pick(rule.field, FIELDS, `${where} rule field`),
    op: pick(rule.op, OPS, `${where} rule op`),
    amount: num(rule.amount, `${where} rule amount`, -1000, 1000),
    everyWeeks: Math.round(num(rule.everyWeeks, `${where} rule cadence`, 1, LIMITS.weeks)),
    startWeek: Math.round(num(rule.startWeek, `${where} rule start`, 1, LIMITS.weeks)),
    endWeek:
      rule.endWeek === null || rule.endWeek === undefined
        ? null
        : Math.round(num(rule.endWeek, `${where} rule end`, 1, LIMITS.weeks)),
    enabled: rule.enabled !== false,
  };
}

/** A v3 row's prescription, or a v1/v2 cell. */
function parsePrescription(value: Record<string, unknown>, where: string): Prescription {
  return {
    sets: optionalNum(value.sets, `${where} sets`, 0, 100),
    reps: optionalNum(value.reps, `${where} reps`, 0, 1000),
    intensityType: pick(value.intensityType ?? "RPE", INTENSITY_TYPES, `${where} intensity type`),
    intensity: optionalNum(value.intensity, `${where} intensity`, -10000, 10000),
    intensityMax: optionalNum(value.intensityMax, `${where} intensity max`, -10000, 10000),
    rampStep: optionalNum(value.rampStep, `${where} ramp`, -1000, 1000),
    coachNotes: optionalText(value.coachNotes, `${where} notes`, LIMITS.notes),
    tempo: optionalText(value.tempo, `${where} tempo`, 40),
    restTime: optionalText(value.restTime, `${where} rest`, 40),
    videoUrl: optionalText(value.videoUrl, `${where} video`, 500),
  };
}

const EMPTY: Prescription = {
  sets: null,
  reps: null,
  intensityType: "RPE",
  intensity: null,
  intensityMax: null,
  rampStep: null,
  coachNotes: null,
  tempo: null,
  restTime: null,
  videoUrl: null,
};

function parseRow(value: unknown, r: number, where: string) {
  const row = obj(value, where);
  return {
    order: Math.round(num(row.order ?? r, `${where} order`, 0, LIMITS.rowsPerDay)),
    tier: pick(row.tier, TIERS, `${where} tier`),
    target: text(row.target, `${where} target`),
    exercise: text(row.exercise, `${where} exercise`),
    rules: list(row.rules ?? [], `${where} rules`, LIMITS.rulesPerRow).map((rule, i) =>
      parseRule(rule, i, where),
    ),
    row,
  };
}

function parseDay<R>(value: unknown, d: number, where: string, readRow: (row: unknown, r: number, where: string) => R) {
  const day = obj(value, `${where}day ${d + 1}`);
  return {
    index: Math.round(num(day.index ?? d, `${where}day ${d + 1} index`, 0, 6)),
    label: text(day.label, `${where}day ${d + 1} label`),
    rest: day.rest === true,
    rows: list(day.rows, `${where}day ${d + 1} rows`, LIMITS.rowsPerDay).map((row, r) =>
      readRow(row, r, `${where}day ${d + 1} row ${r + 1}`),
    ),
  };
}

/**
 * The database keys days by index and rows by order. Rather than letting a duplicate blow
 * up mid-insert, positions are settled here: days keep the first of each index, rows and
 * rules are renumbered by position.
 */
function settleDays(days: ProgramDay[]): ProgramDay[] {
  const seen = new Set<number>();
  return [...days]
    .sort((a, b) => a.index - b.index)
    .filter((day) => !seen.has(day.index) && (seen.add(day.index), true))
    .map((day) => ({
      ...day,
      rows: [...day.rows]
        .sort((a, b) => a.order - b.order)
        .map((row, order) => ({
          ...row,
          order,
          rules: [...row.rules].sort((a, b) => a.order - b.order).map((rule, i) => ({ ...rule, order: i })),
        })),
    }));
}

function phaseHeader(root: Record<string, unknown>, at: number) {
  const where = `phase ${at + 1}`;
  return {
    phase: typeof root.phase === "string" ? text(root.phase, `${where} name`) : `Phase ${at + 1}`,
    startDate:
      root.startDate === undefined
        ? new Date().toISOString().slice(0, 10)
        : date(root.startDate, `${where} start date`),
    squat1RM: optionalNum(root.squat1RM, `${where} squat1RM`, 0, 2000),
    bench1RM: optionalNum(root.bench1RM, `${where} bench1RM`, 0, 2000),
    dead1RM: optionalNum(root.dead1RM, `${where} dead1RM`, 0, 2000),
  };
}

/** Version 3: every week written out whole, with its lock. */
function parsePhase(root: Record<string, unknown>, at: number): ProgramPhase {
  const weeks = list(root.weeks, `phase ${at + 1} weeks`, LIMITS.weeks).map((entry, w) => {
    const where = `phase ${at + 1} week ${w + 1}`;
    const week = obj(entry, where);
    const days = list(week.days, `${where} days`, LIMITS.days).map((day, d) =>
      parseDay(day, d, `${where} `, (value, r, rowWhere) => {
        const { row, ...rest } = parseRow(value, r, rowWhere);
        return { ...rest, ...parsePrescription(row, rowWhere) };
      }),
    );
    return {
      order: Math.round(num(week.week ?? w + 1, `${where} number`, 1, LIMITS.weeks)),
      locked: week.locked === true,
      days: settleDays(days),
    };
  });
  if (weeks.length === 0) fail(`phase ${at + 1} has no weeks`);

  return {
    ...phaseHeader(root, at),
    // Renumbered 1…n in the order the file gives them, so gaps and repeats can't clash.
    weeks: weeks
      .sort((a, b) => a.order - b.order)
      .map(({ locked, days }, i) => ({ week: i + 1, locked, days })),
  };
}

/**
 * Versions 1 and 2: week 1's days and rows, each row carrying a cell per week. Every week
 * is rebuilt from that skeleton with its own cells; rules sit on week 1, where they start.
 */
function parseLegacyPhase(root: Record<string, unknown>, at: number): ProgramPhase {
  const weekCount = Math.round(num(root.weeks, `phase ${at + 1} weeks`, 1, LIMITS.weeks));

  const days = list(root.days, "days", LIMITS.days).map((day, d) =>
    parseDay(day, d, "", (value, r, where) => {
      const { row, ...rest } = parseRow(value, r, where);
      // Cells keep the first of each week; any beyond the phase's length are dropped.
      const cells = new Map<number, Prescription>();
      list(row.cells ?? [], `${where} cells`, LIMITS.cellsPerRow).forEach((entry, i) => {
        const cell = obj(entry, `${where} cell ${i + 1}`);
        const week = Math.round(num(cell.week, `${where} cell week`, 1, LIMITS.weeks));
        const prescription = parsePrescription(cell, where);
        if (week <= weekCount && !cells.has(week)) cells.set(week, prescription);
      });
      return { ...rest, cells };
    }),
  );

  return {
    ...phaseHeader(root, at),
    weeks: Array.from({ length: weekCount }, (_, w) => ({
      week: w + 1,
      locked: false,
      days: settleDays(
        days.map((day) => ({
          ...day,
          rows: day.rows.map(({ cells, rules, ...row }) => ({
            ...row,
            ...(cells.get(w + 1) ?? EMPTY),
            rules: w === 0 ? rules : [],
          })),
        })),
      ),
    })),
  };
}
