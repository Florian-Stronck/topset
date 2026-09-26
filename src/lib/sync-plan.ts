/**
 * The pure half of cloud sync: working out what to send and what to take, with no
 * database in sight. `sync.ts` does the reading and writing.
 *
 * Ownership keeps it conflict-free. The coach owns every table except SetLog and three
 * columns on ExerciseRow; the athlete owns those. Coach data only ever goes up, athlete
 * data only ever comes down — except when the coach edits an athlete column themselves
 * (Tracking), which goes up unless the athlete changed it too, in which case theirs wins.
 *
 * Weigh-ins, check-in answers and the coach's messages are written outright on either side. They merge row by row,
 * the newer edit winning, with deletes kept as tombstones so they travel like edits.
 */

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
  // The coach writes the text, the athlete app when it was read.
  CoachMessage: ["id", "athleteId", "day", "dayId", "rowId", "body", "readAt", "createdAt", "updatedAt", "deletedAt"],
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
export const PULL_ONLY_TABLES = new Set(["AthleteVideo"]);

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
  if (table === "CheckinAnswer") {
    return typeof row.questionId === "string" && row.questionId !== "" && (row.value === null || row.value === undefined || typeof row.value === "string");
  }
  if (table === "CoachMessage") return typeof row.body === "string";
  return true;
}

/** Accounts live on the server alone: sign-ins, invites, push sign-ups, and a coach's login details. */
export const SERVER_TABLES = new Set(["CoachSession", "Invite", "PushSubscription", "PlanNotice"]);
export const SERVER_COLUMNS: Record<string, readonly string[]> = {
  Coach: ["username", "passwordHash", "isAdmin", "athleteVersion", "disabledAt", "resetCodeHash", "resetExpiresAt"],
};

/** Never synced: Prisma's own ledger, SQLite's internals, and the server's own tables. */
export function syncedTable(name: string): boolean {
  return (
    name !== "_prisma_migrations" &&
    !name.startsWith("sqlite_") &&
    !ATHLETE_TABLES.has(name) &&
    !MERGED_TABLES.has(name) &&
    !SERVER_TABLES.has(name)
  );
}

/** The columns of a table that sync carries at all. */
export function syncedColumns(table: string, columns: string[]): string[] {
  const server = SERVER_COLUMNS[table] ?? [];
  return columns.filter((c) => !server.includes(c));
}

/** A row's coach-owned values as one comparable string. */
export function coachSignature(table: string, row: Row, columns: string[]): string {
  const athlete = ATHLETE_COLUMNS[table] ?? [];
  return JSON.stringify(syncedColumns(table, columns).filter((c) => !athlete.includes(c)).map((c) => row[c] ?? null));
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
