import type { Client, InStatement, InValue } from "@libsql/client";
import { checkPush, ownedIdsSql, SCOPE, SCOPED_TABLES, type PushTables } from "@/lib/coach-scope";
import { ATHLETE_COLUMNS, MERGED_COLUMNS, MERGED_TABLES, newerRows, quote, stampOf, syncedColumns, upsertSql, validMergedRow, type Row } from "@/lib/sync-plan";

/**
 * The Topset server's side of sync: what a signed-in coach may read, and applying what their
 * desktop app sends up. Every query is scoped to that coach (see `coach-scope.ts`).
 */

const ROWS_PER_STATEMENT = 100;

function toJson(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof ArrayBuffer) return null;
  return v;
}

async function rows(client: Client, sql: string, args: InValue[]): Promise<Row[]> {
  const rs = await client.execute({ sql, args });
  return rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, toJson(r[i])])) as Row);
}

/** A table's columns only change with a deploy, which starts a fresh process. */
const columnCache = new Map<string, Promise<string[]>>();

function columnsOf(client: Client, table: string): Promise<string[]> {
  let cols = columnCache.get(table);
  if (!cols) {
    cols = rows(client, `PRAGMA table_info(${quote(table)})`, []).then((r) => r.map((c) => String(c.name)));
    // A failed read is not worth remembering.
    cols.catch(() => columnCache.delete(table));
    columnCache.set(table, cols);
  }
  return cols;
}

/** The ids the coach owns, per table: every table, or just the ones named. */
export async function ownedIds(
  client: Client,
  coachId: string,
  only: readonly string[] = SCOPED_TABLES,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const table of SCOPED_TABLES.filter((t) => only.includes(t))) {
    const ids = await rows(client, ownedIdsSql(table), [coachId]);
    out.set(table, new Set(ids.map((r) => String(r.id))));
  }
  return out;
}

/**
 * All of the coach's data, as their desktop app stores it: for a first sign-in on a
 * computer, or with `idsOnly` for comparing what is up here against what it has.
 */
export async function snapshot(client: Client, coachId: string, idsOnly = false): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const table of SCOPED_TABLES) {
    const cols = idsOnly ? ["id"] : syncedColumns(table, await columnsOf(client, table));
    out[table] = await rows(
      client,
      `SELECT ${cols.map(quote).join(", ")} FROM ${quote(table)} WHERE "id" IN (${ownedIdsSql(table)})`,
      [coachId],
    );
  }
  return out;
}

export type AthleteData =
  | { unchanged: true; version: number }
  | { unchanged?: false; version: number; logs: Row[]; rows: Row[]; merged: Record<string, Row[]> };

/**
 * What the coach's athletes logged: every set, and the athlete columns of every row. With
 * `since`, the version the desktop app last took, and nothing logged after it, the answer
 * is just that — one row read instead of all of them.
 */
export async function athleteData(client: Client, coachId: string, since?: number): Promise<AthleteData> {
  // Read before the data, so the data is at least as new as the version handed out with
  // it; anything logged in between bumps it again and comes down next time.
  const [coach] = await rows(client, `SELECT "athleteVersion" FROM "Coach" WHERE "id" = ?`, [coachId]);
  const version = Number(coach?.athleteVersion ?? 0);
  if (since === version) return { unchanged: true, version };

  const cols = ATHLETE_COLUMNS.ExerciseRow;
  const [logs, rowData, ...mergedRows] = await Promise.all([
    rows(client, `SELECT * FROM "SetLog" WHERE "id" IN (${ownedIdsSql("SetLog")}) ORDER BY "id"`, [coachId]),
    rows(
      client,
      `SELECT "id", ${cols.map(quote).join(", ")} FROM "ExerciseRow" WHERE "id" IN (${ownedIdsSql("ExerciseRow")})`,
      [coachId],
    ),
    // Tombstones included: a delete has to reach the desktop copy too.
    ...Object.entries(MERGED_COLUMNS).map(([table, mcols]) =>
      rows(client, `SELECT ${mcols.map(quote).join(", ")} FROM ${quote(table)} WHERE "id" IN (${ownedIdsSql(table)})`, [coachId]),
    ),
  ]);
  const merged = Object.fromEntries(Object.keys(MERGED_COLUMNS).map((table, i) => [table, mergedRows[i]]));
  return { version, logs, rows: rowData, merged };
}

export type PushPayload = {
  tables: PushTables;
  /** The coach's own edits to athlete columns (the Tracking sheet). */
  athlete: { id: string; values: Record<string, unknown> }[];
  /** Rows of merged tables (weigh-ins, readiness) added, changed or deleted here; the newer edit wins. */
  merged?: Record<string, Row[]>;
};

function plain(v: unknown): v is InValue {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Checks and applies one push from a coach's desktop app, in one transaction. */
export async function applyPush(client: Client, coachId: string, payload: PushPayload): Promise<string | null> {
  const tables = payload.tables ?? {};
  // Only what checking this push needs: the tables it touches, and their parents.
  const needed = new Set<string>();
  for (const { table, parents } of SCOPE) {
    if (!tables[table]) continue;
    needed.add(table);
    for (const p of parents) needed.add(p.table);
  }
  if ((payload.athlete ?? []).length > 0) needed.add("ExerciseRow");
  const merged = Object.entries(payload.merged ?? {}).filter(([, list]) => Array.isArray(list) && list.length > 0);
  for (const [table] of merged) {
    if (!MERGED_TABLES.has(table)) return `${table} can't be synced.`;
    needed.add("Athlete").add(table);
  }
  const owned = await ownedIds(client, coachId, [...needed]);

  // Ids sent up that exist but aren't this coach's: someone else's rows.
  const taken = new Set<string>();
  for (const [table, change] of Object.entries(tables)) {
    if (!SCOPED_TABLES.includes(table)) continue;
    const foreign = change.upsert.map((r) => String(r.id)).filter((id) => !owned.get(table)?.has(id));
    for (let i = 0; i < foreign.length; i += 500) {
      const chunk = foreign.slice(i, i + 500);
      const hit = await rows(client, `SELECT "id" FROM ${quote(table)} WHERE "id" IN (${chunk.map(() => "?").join(", ")})`, chunk);
      hit.forEach((r) => taken.add(String(r.id)));
    }
  }

  const problem = checkPush(coachId, tables, owned, taken);
  if (problem) return problem;

  const stmts: InStatement[] = [];

  // Children before parents on the way out.
  for (const { table } of [...SCOPE].reverse()) {
    const remove = tables[table]?.remove ?? [];
    for (let i = 0; i < remove.length; i += ROWS_PER_STATEMENT) {
      const chunk = remove.slice(i, i + ROWS_PER_STATEMENT);
      stmts.push({ sql: `DELETE FROM ${quote(table)} WHERE "id" IN (${chunk.map(() => "?").join(", ")})`, args: chunk });
    }
  }

  for (const { table } of SCOPE) {
    const upsert = tables[table]?.upsert ?? [];
    if (upsert.length === 0) continue;
    const known = syncedColumns(table, await columnsOf(client, table));
    const sent = Object.keys(upsert[0]);
    const unknown = sent.filter((c) => !known.includes(c));
    if (unknown.length) return `${table} has no ${unknown.join(", ")} column here — update the server first.`;
    for (const row of upsert) {
      for (const c of sent) if (!plain(row[c])) return `${table}.${c} isn't a plain value.`;
    }

    if (table === "Coach") {
      // A coach can rename themselves and change their settings; login details stay put.
      const row = upsert[0];
      stmts.push({
        sql: `UPDATE "Coach" SET "name" = ?, "settings" = ? WHERE "id" = ?`,
        args: [String(row.name ?? ""), String(row.settings ?? "{}"), coachId],
      });
      continue;
    }
    if (table === "Athlete" && upsert.some((r) => r.coachId !== coachId)) return "An athlete can only be yours.";

    for (let i = 0; i < upsert.length; i += ROWS_PER_STATEMENT) {
      const chunk = upsert.slice(i, i + ROWS_PER_STATEMENT);
      stmts.push({
        sql: upsertSql(table, sent, chunk.length),
        args: chunk.flatMap((r) => sent.map((c) => (r[c] ?? null) as InValue)),
      });
    }
  }

  const athleteCols = ATHLETE_COLUMNS.ExerciseRow;
  for (const edit of payload.athlete ?? []) {
    if (!owned.get("ExerciseRow")?.has(edit.id)) return "That row isn't yours.";
    const values = athleteCols.map((c) => edit.values[c] ?? null);
    if (!values.every(plain)) return "Logged values must be plain.";
    stmts.push({
      sql: `UPDATE "ExerciseRow" SET ${athleteCols.map((c) => `${quote(c)} = ?`).join(", ")} WHERE "id" = ?`,
      args: [...(values as InValue[]), edit.id],
    });
  }

  // Merged rows: each must hang off one of this coach's athletes, and an id already here
  // must be theirs. Only an edit newer than the copy here is written.
  // An athlete created in this same push counts: its rows were checked as the coach's above.
  const athletes = new Set([...(owned.get("Athlete") ?? []), ...(tables.Athlete?.upsert ?? []).map((r) => String(r.id))]);
  for (const [table, list] of merged) {
    const cols = [...MERGED_COLUMNS[table]];
    const mine = owned.get(table) ?? new Set<string>();
    for (const row of list) {
      if (!validMergedRow(table, row)) return `A ${table} row is missing something.`;
      if (!athletes.has(String(row.athleteId))) return "That athlete isn't yours.";
    }
    const ids = list.map((r) => r.id);
    const held = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const hit = await rows(client, `SELECT "id", "updatedAt" FROM ${quote(table)} WHERE "id" IN (${chunk.map(() => "?").join(", ")})`, chunk);
      for (const r of hit) {
        if (!mine.has(String(r.id))) return `${table} ${r.id} belongs to someone else.`;
        held.set(String(r.id), stampOf(r.updatedAt));
      }
    }
    const fresh = newerRows(list, held);
    for (let i = 0; i < fresh.length; i += ROWS_PER_STATEMENT) {
      const chunk = fresh.slice(i, i + ROWS_PER_STATEMENT);
      stmts.push({
        sql: upsertSql(table, cols, chunk.length),
        args: chunk.flatMap((r) => cols.map((c) => (r[c] ?? null) as InValue)),
      });
    }
  }

  if (stmts.length === 0) return null;

  // The coach's own edits to athlete data are news to any other computer they use.
  if ((payload.athlete ?? []).length > 0 || merged.length > 0) {
    stmts.push({ sql: `UPDATE "Coach" SET "athleteVersion" = "athleteVersion" + 1 WHERE "id" = ?`, args: [coachId] });
  }

  // Foreign keys are off while this runs, so anything left without a parent goes too.
  // Only a removal can leave one behind, and the sweep reads every table in the
  // database, so a push that only adds and edits skips it.
  if (Object.values(tables).some((t) => (t.remove?.length ?? 0) > 0)) {
    for (const { table, parents } of SCOPE) {
      const [parent] = parents;
      if (!parent) continue;
      stmts.push(`DELETE FROM ${quote(table)} WHERE ${quote(parent.column)} NOT IN (SELECT "id" FROM ${quote(parent.table)})`);
    }
  }

  await client.migrate(stmts);
  return null;
}

/**
 * Erases a coach and everything that hangs off them — athletes, programs, what their
 * athletes logged — and their sign-ins, so the username is free again. One transaction,
 * children first; the ids are picked while the parents they're found through still exist.
 */
export async function deleteCoach(client: Client, coachId: string): Promise<void> {
  const stmts: InStatement[] = [];
  for (const { table } of [...SCOPE].reverse()) {
    if (table === "Coach") continue;
    stmts.push({ sql: `DELETE FROM ${quote(table)} WHERE "id" IN (${ownedIdsSql(table)})`, args: [coachId] });
  }
  stmts.push({ sql: `DELETE FROM "CoachSession" WHERE "coachId" = ?`, args: [coachId] });
  stmts.push({ sql: `DELETE FROM "Coach" WHERE "id" = ?`, args: [coachId] });
  await client.migrate(stmts);
}
