/**
 * The pure half of cloud sync: working out what to send and what to take, with no
 * database in sight. `sync.ts` does the reading and writing.
 *
 * Ownership keeps it mostly conflict-free. The coach owns every table except SetLog and
 * three columns on ExerciseRow; the athlete owns those. Athlete data only ever comes down —
 * except when the coach edits an athlete column themselves (Tracking), which goes up unless
 * the athlete changed it too, in which case theirs wins. Coach data goes up, and comes down
 * only to the coach's other computers; there the last push of a row wins.
 *
 * Weigh-ins, nutrition, check-in answers, the coach's messages, moved sessions and meetings are written outright on either side. They merge row by row,
 * the newer edit winning, with deletes kept as tombstones so they travel like edits.
 */

import { createHash } from "node:crypto";
import { validMeeting } from "@/lib/meetings";
import { nutritionId } from "@/lib/nutrition";
import { moveId } from "@/lib/moves";

export type Row = Record<string, unknown> & { id: string };

/** Columns the athlete app writes, per table. Everything else in that table is the coach's. */
export const ATHLETE_COLUMNS: Record<string, readonly string[]> = {
  ExerciseRow: ["actualWeight", "performedRpe", "athleteNotes"],
};

/** Tables only the athlete app writes to. */
export const ATHLETE_TABLES = new Set(["SetLog"]);

/**
 * Tables merged row by row on `updatedAt`, with the columns sync carries for each. Every
 * one hangs off an athlete, is dated by `day`, and deletes by setting `deletedAt`.
 */
export const MERGED_COLUMNS: Record<string, readonly string[]> = {
  BodyweightLog: ["id", "athleteId", "day", "weight", "note", "source", "createdAt", "updatedAt", "deletedAt"],
  CheckinAnswer: ["id", "athleteId", "questionId", "day", "value", "createdAt", "updatedAt", "deletedAt"],
  NutritionLog: ["id", "athleteId", "day", "kcal", "protein", "carbs", "fat", "source", "createdAt", "updatedAt", "deletedAt"],
  // Photos on check-in answers: like videos, only the athlete app writes them.
  CheckinPhoto: ["id", "athleteId", "questionId", "day", "contentType", "size", "storageKey", "uploadedAt", "createdAt", "updatedAt", "deletedAt"],
  // The chat: whoever sent it writes the text, the other side when it was read.
  CoachMessage: ["id", "athleteId", "sender", "day", "dayId", "rowId", "body", "readAt", "createdAt", "updatedAt", "deletedAt"],
  // The athlete moves a session; the coach marks it seen or puts it back.
  SessionMove: ["id", "athleteId", "dayId", "fromDay", "day", "reason", "seenAt", "createdAt", "updatedAt", "deletedAt"],
  // Either side proposes a meeting, the other answers it.
  Meeting: ["id", "athleteId", "day", "time", "minutes", "timeZone", "place", "note", "proposedBy", "status", "createdAt", "updatedAt", "deletedAt"],
  // Either side reports or clears an injury.
  Injury: ["id", "athleteId", "area", "side", "day", "endDay", "severity", "note", "source", "createdAt", "updatedAt", "deletedAt"],
  // Videos the athlete sent: only the athlete app writes them, so they only ever come down.
  AthleteVideo: [
    "id",
    "athleteId",
    "rowId",
    "day",
    "setIndex",
    "name",
    "contentType",
    "size",
    "storageKey",
    "uploadedAt",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ],
};

export const MERGED_TABLES = new Set(Object.keys(MERGED_COLUMNS));

/**
 * Merged tables a desktop app may never send up. A video row names where its file is in
 * storage; one written by a desktop app could point at anyone's file.
 */
export const PULL_ONLY_TABLES = new Set(["AthleteVideo", "CheckinPhoto"]);

const plainValue = (v: unknown) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** A merged row as sync may write it: the columns it needs there, and of the right kind. */
export function validMergedRow(table: string, row: Row): boolean {
  const cols = MERGED_COLUMNS[table];
  if (!cols) return false;
  const base =
    typeof row.id === "string" &&
    row.id !== "" &&
    typeof row.athleteId === "string" &&
    typeof row.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.day) &&
    cols.every((c) => plainValue(row[c] ?? null));
  if (!base) return false;
  if (table === "BodyweightLog") return typeof row.weight === "number" && Number.isFinite(row.weight);
  // The id names the athlete and day, so it must be theirs: otherwise a row sent up could sit
  // under another athlete's id and catch their check-in answers.
  if (table === "NutritionLog") return row.id === nutritionId(String(row.athleteId), String(row.day));
  if (table === "CheckinAnswer") {
    return typeof row.questionId === "string" && row.questionId !== "" && (row.value === null || row.value === undefined || typeof row.value === "string");
  }
  if (table === "CoachMessage") {
    // An older desktop app sends no sender: everything it has is the coach's.
    return typeof row.body === "string" && (row.sender === undefined || row.sender === "coach" || row.sender === "athlete");
  }
  // Named by its session, so it must be the athlete's own move of it.
  if (table === "SessionMove") {
    return (
      typeof row.dayId === "string" &&
      row.id === moveId(row.dayId) &&
      typeof row.fromDay === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.fromDay)
    );
  }
  if (table === "Meeting") return validMeeting(row);
  if (table === "Injury") {
    return (
      typeof row.area === "string" &&
      row.area !== "" &&
      typeof row.severity === "number" &&
      (row.endDay === null || row.endDay === undefined || (typeof row.endDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.endDay)))
    );
  }
  return true;
}

/**
 * Accounts live on the server alone: sign-ins, invites, push sign-ups, sign-in tries, and a
 * coach's login details. Teams too: a desktop app keeps a copy, but only the admin changes
 * them, on the server (see `pullAccess` in sync.ts).
 */
export const SERVER_TABLES = new Set(["CoachSession", "Invite", "PushSubscription", "PlanNotice", "LoginAttempt", "PlanChange", "Team", "TeamMember"]);

/** A desktop app's own sync bookkeeping (see `sync.ts`). */
export const LOCAL_TABLES = new Set(["SyncSent", "SyncMeta"]);
export const SERVER_COLUMNS: Record<string, readonly string[]> = {
  Coach: ["username", "passwordHash", "isAdmin", "athleteVersion", "disabledAt", "resetCodeHash", "resetExpiresAt"],
};

/**
 * Columns that come down with a row but are only ever set on the server: which team an
 * athlete is on. A push never carries them, and a change to them isn't an edit to send.
 */
export const PULLED_COLUMNS: Record<string, readonly string[]> = {
  Athlete: ["teamId"],
};

/** The columns of a table a desktop app sends up. */
export function pushedColumns(table: string, columns: string[]): string[] {
  const pulled = PULLED_COLUMNS[table] ?? [];
  return syncedColumns(table, columns).filter((c) => !pulled.includes(c));
}

/** Never synced: Prisma's own ledger, SQLite's internals, and the server's own tables. */
export function syncedTable(name: string): boolean {
  return (
    name !== "_prisma_migrations" &&
    !name.startsWith("sqlite_") &&
    !ATHLETE_TABLES.has(name) &&
    !MERGED_TABLES.has(name) &&
    !SERVER_TABLES.has(name) &&
    !LOCAL_TABLES.has(name)
  );
}

/** The columns of a table that sync carries at all. */
export function syncedColumns(table: string, columns: string[]): string[] {
  const server = SERVER_COLUMNS[table] ?? [];
  return columns.filter((c) => !server.includes(c));
}

/**
 * A row's coach-owned values as one short comparable string: a digest, since a desktop app
 * keeps one for every row it has sent (SyncSent).
 */
export function coachSignature(table: string, row: Row, columns: string[]): string {
  const athlete = ATHLETE_COLUMNS[table] ?? [];
  const values = JSON.stringify(pushedColumns(table, columns).filter((c) => !athlete.includes(c)).map((c) => row[c] ?? null));
  return createHash("sha1").update(values).digest("base64");
}

/** A row's athlete-owned values as one comparable string. */
export function athleteSignature(table: string, row: Row): string {
  return JSON.stringify((ATHLETE_COLUMNS[table] ?? []).map((c) => row[c] ?? null));
}

export type TableChanges = { upsert: Row[]; remove: string[]; signatures: Map<string, string> };

/**
 * What of one table has to go up: rows that are new or differ from what was last sent,
 * and ids that were sent before but are gone here now.
 */
export function tableChanges(
  table: string,
  rows: Row[],
  columns: string[],
  sent: Map<string, string>,
): TableChanges {
  const signatures = new Map<string, string>();
  const upsert: Row[] = [];
  for (const row of rows) {
    const sig = coachSignature(table, row, columns);
    signatures.set(row.id, sig);
    if (sent.get(row.id) !== sig) upsert.push(row);
  }
  const remove = [...sent.keys()].filter((id) => !signatures.has(id));
  return { upsert, remove, signatures };
}

/**
 * Bringing the local sets in line with the server's, touching only those that differ:
 * new or changed ones go in, and ones gone from the server — or changed on it — come out
 * first, so a set moving to another number never collides with its old slot.
 */
export function logChanges(local: Row[], remote: Row[], columns: string[]): { insert: Row[]; remove: string[] } {
  const sig = (r: Row) => JSON.stringify(columns.map((c) => r[c] ?? null));
  const mine = new Map(local.map((r) => [r.id, sig(r)]));
  const insert = remote.filter((r) => mine.get(r.id) !== sig(r));
  const theirs = new Set(remote.map((r) => r.id));
  const remove = [
    ...local.filter((r) => !theirs.has(r.id)).map((r) => r.id),
    ...insert.filter((r) => mine.has(r.id)).map((r) => r.id),
  ];
  return { insert, remove };
}

export type AthleteMerge = {
  /** Take the cloud's values into the local row. */
  take: boolean;
  /** Send the local values up. */
  send: boolean;
  /** What both sides agree on afterwards — the base for next time. */
  base: string;
};

/**
 * Three-way merge of a row's athlete columns: `base` is what both sides last agreed on.
 * A change on the cloud side is the athlete's and wins; a change only on this side is
 * the coach's and goes up.
 */
export function mergeAthleteColumns(local: string, cloud: string, base: string | undefined): AthleteMerge {
  if (base === undefined || cloud !== base) return { take: local !== cloud, send: false, base: cloud };
  if (local !== base) return { take: false, send: true, base: local };
  return { take: false, send: false, base };
}

/**
 * A stored timestamp as milliseconds. SQLite holds Prisma's DateTimes as ISO text, but a
 * row written by hand may carry a number; anything unreadable counts as the beginning.
 */
export function stampOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

/**
 * Last edit wins, row by row: the rows of `incoming` that are new to `held`, or edited
 * after the copy `held` has of them. Used both ways — what a pull takes, what a push sends.
 */
export function newerRows(incoming: Row[], held: Map<string, number>): Row[] {
  return incoming.filter((r) => {
    const mine = held.get(r.id);
    return mine === undefined || stampOf(r.updatedAt) > mine;
  });
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * INSERT … ON CONFLICT(id) DO UPDATE for a batch of rows. A new row goes in whole; an
 * existing one only has its coach columns replaced, so a set logged meanwhile survives.
 */
export function upsertSql(table: string, columns: string[], count: number): string {
  const athlete = ATHLETE_COLUMNS[table] ?? [];
  const values = Array.from({ length: count }, () => `(${columns.map(() => "?").join(", ")})`).join(", ");
  const updates = columns
    .filter((c) => c !== "id" && !athlete.includes(c))
    .map((c) => `${quote(c)} = excluded.${quote(c)}`);
  return (
    `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES ${values} ` +
    (updates.length ? `ON CONFLICT("id") DO UPDATE SET ${updates.join(", ")}` : `ON CONFLICT("id") DO NOTHING`)
  );
}

export { quote };
