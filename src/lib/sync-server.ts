import type { Client, InStatement, InValue } from "@libsql/client";
import { athleteChain, checkPush, ownedIdsSql, SCOPE, SCOPED_TABLES, withoutReadOnly, type PushTables } from "@/lib/coach-scope";
import { isRole, type Role } from "@/lib/roles";
import { meetingNews, type MeetingNews } from "@/lib/meetings";
import { ATHLETE_COLUMNS, MERGED_COLUMNS, MERGED_TABLES, PULL_ONLY_TABLES, newerRows, quote, stampOf, syncedColumns, upsertSql, validMergedRow, type Row } from "@/lib/sync-plan";

/**
 * The Topset server's side of sync: what a signed-in coach may read, and applying what their
 * desktop app sends up. Every query is scoped to that coach (see `coach-scope.ts`).
 *
 * `shared` (from desktop apps new enough for shares) widens what is read to athletes other
 * coaches shared with this one. Older apps get only the coach's own, as before: they would
 * trip over another coach's athletes, and couldn't tell which they may change.
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

/** The ids the coach owns (or with `shared`, may see or has that role on), per table: every table, or just the ones named. */
export async function ownedIds(
  client: Client,
  coachId: string,
  only: readonly string[] = SCOPED_TABLES,
  shared: boolean | Role = false,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const table of SCOPED_TABLES.filter((t) => only.includes(t))) {
    const ids = await rows(client, ownedIdsSql(table, shared), [coachId]);
    out.set(table, new Set(ids.map((r) => String(r.id))));
  }
  return out;
}

/**
 * All of the coach's data, as their desktop app stores it: for a first sign-in on a
 * computer, or with `idsOnly` for comparing what is up here against what it has. With
 * `athletes`, only what hangs off those athletes: ones just shared with the coach.
 */
export async function snapshot(
  client: Client,
  coachId: string,
  idsOnly = false,
  shared = false,
  athletes?: string[],
): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const table of SCOPED_TABLES) {
    const cols = idsOnly ? ["id"] : syncedColumns(table, await columnsOf(client, table));
    if (!athletes) {
      out[table] = await rows(
        client,
        `SELECT ${cols.map(quote).join(", ")} FROM ${quote(table)} WHERE "id" IN (${ownedIdsSql(table, shared)})`,
        [coachId],
      );
      continue;
    }
    const chain = athleteChain(table);
    if (!chain || athletes.length === 0) continue;
    out[table] = await rows(
      client,
      `SELECT ${cols.map((c) => `t0.${quote(c)}`).join(", ")} FROM ${chain.from} ` +
        `WHERE ${chain.athlete} IN (${athletes.map(() => "?").join(", ")}) AND t0."id" IN (${ownedIdsSql(table, shared)})`,
      [...athletes, coachId],
    );
  }
  return out;
}

/**
 * How far the PlanChange log goes. Read before a snapshot, so anything pushed while it is
 * being read comes down again with the next plan pull. The whole log's end: which entries
 * are the coach's is for the pull to work out.
 */
export async function planRev(client: Client): Promise<number> {
  const [r] = await rows(client, `SELECT COALESCE(MAX("rev"), 0) AS "rev" FROM "PlanChange"`, []);
  return Number(r?.rev ?? 0);
}

/** Log entries per plan pull, well under the response size limit once turned into rows. */
export const PLAN_PAGE = 2000;

export type PlanData = {
  /** Where this answer ends in the log; the next pull asks from here. */
  rev: number;
  /** There is more after `rev`: ask again straight away. */
  more: boolean;
  /** Rows as the server has them now, per table. */
  rows: Record<string, Row[]>;
  /** Ids gone from the server, per table. */
  removed: Record<string, string[]>;
};

/**
 * What the coach's other computers, and coaches sharing their athletes, changed in the coach's plans since
 * `since`: the rows as they are now, and the ones that are gone. A row whose last change
 * came from this computer (`sessionId`) is left out, since it already has it.
 */
export async function planData(
  client: Client,
  coachId: string,
  sessionId: string,
  since: number,
  limit = PLAN_PAGE,
  shared = false,
): Promise<PlanData> {
  // By athlete, so another coach's edit to a shared athlete counts; entries without one are
  // the coach's own profile, or from before the log named athletes.
  const log = await rows(
    client,
    `SELECT "rev", "table", "rowId", "sessionId" FROM "PlanChange" WHERE "rev" > ? ` +
      `AND ("athleteId" IN (${ownedIdsSql("Athlete", shared)}) OR ("athleteId" IS NULL AND "coachId" = ?)) ORDER BY "rev" LIMIT ?`,
    [since, coachId, coachId, limit],
  );
  const rev = log.length ? Number(log[log.length - 1].rev) : since;
  const latest = new Map<string, Row>();
  for (const entry of log) latest.set(`${entry.table}/${entry.rowId}`, entry);
  const wanted = new Map<string, string[]>();
  for (const entry of latest.values()) {
    if (entry.sessionId === sessionId || !SCOPED_TABLES.includes(String(entry.table))) continue;
    const list = wanted.get(String(entry.table)) ?? [];
    list.push(String(entry.rowId));
    wanted.set(String(entry.table), list);
  }

  const out: PlanData = { rev, more: log.length === limit, rows: {}, removed: {} };
  for (const { table } of SCOPE) {
    const ids = wanted.get(table);
    if (!ids) continue;
    const cols = syncedColumns(table, await columnsOf(client, table));
    const found: Row[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      found.push(
        ...(await rows(
          client,
          `SELECT ${cols.map(quote).join(", ")} FROM ${quote(table)} WHERE "id" IN (${chunk.map(() => "?").join(", ")}) AND "id" IN (${ownedIdsSql(table, shared)})`,
          [...chunk, coachId],
        )),
      );
    }
    const here = new Set(found.map((r) => String(r.id)));
    if (found.length) out.rows[table] = found;
    const gone = ids.filter((id) => !here.has(id));
    if (gone.length) out.removed[table] = gone;
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
export async function athleteData(client: Client, coachId: string, since?: number, shared = false): Promise<AthleteData> {
  // Read before the data, so the data is at least as new as the version handed out with
  // it; anything logged in between bumps it again and comes down next time.
  const [coach] = await rows(client, `SELECT "athleteVersion" FROM "Coach" WHERE "id" = ?`, [coachId]);
  const version = Number(coach?.athleteVersion ?? 0);
  if (since === version) return { unchanged: true, version };

  const cols = ATHLETE_COLUMNS.ExerciseRow;
  const [logs, rowData, ...mergedRows] = await Promise.all([
    rows(client, `SELECT * FROM "SetLog" WHERE "id" IN (${ownedIdsSql("SetLog", shared)}) ORDER BY "id"`, [coachId]),
    rows(
      client,
      `SELECT "id", ${cols.map(quote).join(", ")} FROM "ExerciseRow" WHERE "id" IN (${ownedIdsSql("ExerciseRow", shared)})`,
      [coachId],
    ),
    // Tombstones included: a delete has to reach the desktop copy too.
    ...Object.entries(MERGED_COLUMNS).map(([table, mcols]) =>
      rows(client, `SELECT ${mcols.map(quote).join(", ")} FROM ${quote(table)} WHERE "id" IN (${ownedIdsSql(table, shared)})`, [coachId]),
    ),
  ]);
  const merged = Object.fromEntries(Object.keys(MERGED_COLUMNS).map((table, i) => [table, mergedRows[i]]));
  return { version, logs, rows: rowData, merged };
}

/**
 * Tells the desktop app of `coachId`, and of every coach who may see these athletes, that
 * something new was logged (see `athleteData`): the athletes' owners, and whoever they're shared with.
 */
export function bumpAthleteVersion(coachId: string, athleteIds: string[]): InStatement {
  const ids = athleteIds.map(() => "?").join(", ");
  return {
    sql:
      `UPDATE "Coach" SET "athleteVersion" = "athleteVersion" + 1 WHERE "id" = ? ` +
      `OR "id" IN (SELECT "coachId" FROM "Athlete" WHERE "id" IN (${ids})) ` +
      `OR "id" IN (SELECT "coachId" FROM "AthleteShare" WHERE "athleteId" IN (${ids}))`,
    args: [coachId, ...athleteIds, ...athleteIds],
  };
}

export type AccessData = {
  /** The owners of athletes shared with the coach, and the coaches theirs are shared with: names only. */
  coaches: { id: string; name: string }[];
  /** Every athlete the coach may see, with what they may do: "own" for their own. */
  athletes: { id: string; role: Role | "own" }[];
  /** Who the coach's own athletes are shared with. */
  shares: { athleteId: string; coachId: string; role: Role }[];
};

/** What a desktop app needs to keep its copy of the coach's roster and shares right. */
export async function accessData(client: Client, coachId: string): Promise<AccessData> {
  const athletes = await rows(
    client,
    `SELECT a."id", a."coachId", s."role" FROM "Athlete" a LEFT JOIN "AthleteShare" s ON s."athleteId" = a."id" AND s."coachId" = ? ` +
      `WHERE a."id" IN (${ownedIdsSql("Athlete", true)})`,
    [coachId, coachId],
  );
  const shares = await rows(
    client,
    `SELECT s."athleteId", s."coachId", s."role" FROM "AthleteShare" s JOIN "Athlete" a ON a."id" = s."athleteId" WHERE a."coachId" = ?`,
    [coachId],
  );
  const others = [...new Set([...athletes, ...shares].map((r) => String(r.coachId)))].filter((id) => id !== coachId);
  const coaches = others.length
    ? await rows(client, `SELECT "id", "name" FROM "Coach" WHERE "id" IN (${others.map(() => "?").join(", ")})`, others)
    : [];
  return {
    coaches: coaches.map((c) => ({ id: String(c.id), name: String(c.name) })),
    athletes: athletes.map((a) => ({ id: String(a.id), role: a.coachId === coachId ? "own" : isRole(a.role) ? a.role : "view" })),
    shares: shares.filter((r) => isRole(r.role)).map((r) => ({ athleteId: String(r.athleteId), coachId: String(r.coachId), role: r.role as Role })),
  };
}

export type PushPayload = {
  tables: PushTables;
  /** The coach's own edits to athlete columns (the Tracking sheet). */
  athlete: { id: string; values: Record<string, unknown> }[];
  /** Rows of merged tables (weigh-ins, check-in answers, messages) added, changed or deleted here; the newer edit wins. */
  merged?: Record<string, Row[]>;
};

function plain(v: unknown): v is InValue {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** A note from the coach the athlete hasn't seen: new, or reworded since they had it. */
export type NewNote = { id: string; athleteId: string; day: string; body: string };

/** A meeting the coach proposed, answered or called off. */
export type NewMeeting = { id: string; athleteId: string; day: string; time: string; news: MeetingNews };

/** What a push changed that athletes may want to hear about. */
export type PushNews = { notes: NewNote[]; plans: Set<string>; meetings: NewMeeting[] };

export function pushNews(): PushNews {
  return { notes: [], plans: new Set(), meetings: [] };
}

/**
 * The tables an athlete's plan is made of, with the columns that aren't the plan: marking
 * a session reviewed or locking a week changes nothing the athlete sees.
 */
const PLAN_TABLES: Record<string, readonly string[]> = {
  Program: [],
  Block: [],
  Week: ["locked"],
  Day: ["reviewedAt"],
  ExerciseRow: [],
};

/**
 * Columns under a unique index, and a value each can wait at that no other row holds. The
 * desktop app moves rows into each other's places one at a time (a row inserted or moved
 * within a day, a week put in between, a progression chain relinked); here they arrive
 * together, so the rows a push brings first let go of their places, then take the new ones.
 */
const SLOTS: Record<string, Record<string, string>> = {
  Week: { order: "-1 - rowid" },
  Day: { index: "-1 - rowid" },
  ExerciseRow: { order: "-1 - rowid", fromId: "NULL" },
  Attempt: { number: "-1 - rowid" },
};

/** A stored value in one comparable form, whichever SQLite driver read it. */
function norm(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  return String(v);
}

/** SQL for the athlete ids behind some rows of `table`, found up its chain of parents. */
function athleteIdsSql(table: string, ids: string): string {
  const entry = SCOPE.find((e) => e.table === table);
  const [parent] = entry?.parents ?? [];
  if (!parent) throw new Error(`No athlete above ${table}.`);
  const up = `SELECT ${quote(parent.column)} FROM ${quote(table)} WHERE "id" IN (${ids})`;
  return parent.table === "Athlete" ? up : athleteIdsSql(parent.table, up);
}

async function athletesOf(client: Client, table: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const sql = `SELECT DISTINCT "id" FROM "Athlete" WHERE "id" IN (${athleteIdsSql(table, chunk.map(() => "?").join(", "))})`;
    out.push(...(await rows(client, sql, chunk)).map((r) => String(r.id)));
  }
  return out;
}

/**
 * The plan rows this push really changes, per table. A desktop app that just started sends
 * everything again, so each row is held against the copy here rather than taken at its word.
 */
async function planChanges(client: Client, tables: PushTables) {
  const upserted = new Map<string, string[]>();
  const removed = new Map<string, string[]>();
  for (const [table, ignored] of Object.entries(PLAN_TABLES)) {
    const change = tables[table];
    if (!change) continue;
    if (change.remove.length) removed.set(table, change.remove);
    if (change.upsert.length === 0) continue;
    const skip = new Set([...ignored, ...(ATHLETE_COLUMNS[table] ?? [])]);
    const cols = Object.keys(change.upsert[0]).filter((c) => !skip.has(c));
    const changed: string[] = [];
    for (let i = 0; i < change.upsert.length; i += 500) {
      const chunk = change.upsert.slice(i, i + 500);
      const ids = chunk.map((r) => String(r.id));
      const held = new Map(
        (await rows(client, `SELECT * FROM ${quote(table)} WHERE "id" IN (${ids.map(() => "?").join(", ")})`, ids)).map((r) => [String(r.id), r]),
      );
      for (const row of chunk) {
        const before = held.get(String(row.id));
        if (!before || cols.some((c) => norm(before[c]) !== norm(row[c]))) changed.push(String(row.id));
      }
    }
    if (changed.length) upserted.set(table, changed);
  }
  return { upserted, removed };
}

async function existing(client: Client, table: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const hit = await rows(client, `SELECT "id" FROM ${quote(table)} WHERE "id" IN (${chunk.map(() => "?").join(", ")})`, chunk);
    hit.forEach((r) => out.add(String(r.id)));
  }
  return out;
}

/**
 * A push without what another of the coach's computers has already deleted: removals of
 * rows no longer here at all, and new rows under a parent no longer here (and so everything
 * under those). Both are races between two computers, not mistakes, and must not stop sync.
 * A row pointing at someone else's parent stays in, for `checkPush` to refuse.
 */
async function withoutVanished(client: Client, tables: PushTables, owned: Map<string, Set<string>>): Promise<PushTables> {
  const out: PushTables = {};
  const kept = new Map<string, Set<string>>();
  for (const { table, parents } of SCOPE) {
    const change = tables[table];
    if (!change) continue;
    const mine = owned.get(table) ?? new Set<string>();

    const strange = change.remove.filter((id) => !mine.has(id));
    const there = strange.length ? await existing(client, table, strange) : new Set<string>();
    const remove = change.remove.filter((id) => mine.has(id) || there.has(id));

    // Parents this push neither has nor brings: gone, unless they turn out to exist.
    const missing = new Map<string, Set<string>>();
    for (const p of parents) {
      const ids = new Set<string>();
      for (const row of change.upsert) {
        const v = row[p.column];
        if (v === null || v === undefined) continue;
        const id = String(v);
        const arriving = p.table === table ? change.upsert.some((r) => r.id === id) : kept.get(p.table)?.has(id);
        if (!owned.get(p.table)?.has(id) && !arriving) ids.add(id);
      }
      const found = ids.size ? await existing(client, p.table, [...ids]) : new Set<string>();
      missing.set(p.column, new Set([...ids].filter((id) => !found.has(id))));
    }
    const upsert: Row[] = [];
    for (const row of change.upsert) {
      let drop = false;
      let copy = row;
      for (const p of parents) {
        if (!missing.get(p.column)?.has(String(row[p.column]))) continue;
        // A copy pointing back at a row that is gone just stops pointing.
        if (p.optional) copy = { ...copy, [p.column]: null };
        else drop = true;
      }
      if (!drop) upsert.push(copy);
    }
    kept.set(table, new Set(upsert.map((r) => String(r.id))));
    out[table] = { upsert, remove };
  }
  // Tables sync doesn't know stay in, for `checkPush` to refuse by name.
  for (const [table, change] of Object.entries(tables)) out[table] ??= change;
  return out;
}

/**
 * Checks and applies one push from a coach's desktop app, in one transaction. What it
 * changed that athletes should hear about goes in `news`, once it's in.
 */
export async function applyPush(
  client: Client,
  coachId: string,
  payload: PushPayload,
  news: PushNews = pushNews(),
  sessionId: string | null = null,
): Promise<string | null> {
  const sent = payload.tables ?? {};
  // Only what checking this push needs: the tables it touches, and their parents.
  const needed = new Set<string>();
  for (const { table, parents } of SCOPE) {
    if (!sent[table]) continue;
    needed.add(table);
    for (const p of parents) needed.add(p.table);
  }
  if ((payload.athlete ?? []).length > 0) needed.add("ExerciseRow");
  const merged = Object.entries(payload.merged ?? {}).filter(([, list]) => Array.isArray(list) && list.length > 0);
  for (const [table] of merged) {
    if (!MERGED_TABLES.has(table) || PULL_ONLY_TABLES.has(table)) return `${table} can't be synced.`;
    needed.add("Athlete").add(table);
    if (table === "CheckinAnswer") needed.add("CheckinQuestion");
    if (table === "SessionMove") needed.add("Day");
  }
  // Athletes shared to edit count as the coach's own, whichever app this is: an older one
  // never sends them. What is shared only to view or review is dropped from the push, bar
  // the Reviewed mark (see `withoutReadOnly`); notes come in below, with review enough.
  const owned = await ownedIds(client, coachId, [...needed], "edit");
  const visible = await ownedIds(client, coachId, [...needed], true);
  const readOnly = new Map([...visible].map(([table, ids]) => [table, new Set([...ids].filter((id) => !owned.get(table)?.has(id)))]));
  const review = await ownedIds(client, coachId, ["Day", "Athlete", "CoachMessage"].filter((t) => needed.has(t)), "review");
  const { tables: writable, reviews } = withoutReadOnly(sent, readOnly, review.get("Day"));
  const tables = await withoutVanished(client, writable, owned);

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

  // Whose the shared athletes in this push are.
  const owners = new Map<string, string>();
  const touched = [...(tables.Athlete?.upsert ?? []).map((r) => String(r.id)), ...(tables.Athlete?.remove ?? [])].filter((id) =>
    owned.get("Athlete")?.has(id),
  );
  for (let i = 0; i < touched.length; i += 500) {
    const chunk = touched.slice(i, i + 500);
    const hit = await rows(
      client,
      `SELECT "id", "coachId" FROM "Athlete" WHERE "id" IN (${chunk.map(() => "?").join(", ")}) AND "coachId" != ?`,
      [...chunk, coachId],
    );
    for (const r of hit) owners.set(String(r.id), String(r.coachId));
  }

  const problem = checkPush(coachId, tables, owned, taken, owners);
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
    const park = Object.entries(SLOTS[table] ?? {}).filter(([c]) => sent.includes(c));
    for (let i = 0; park.length && i < upsert.length; i += ROWS_PER_STATEMENT) {
      const ids = upsert.slice(i, i + ROWS_PER_STATEMENT).map((r) => String(r.id));
      stmts.push({
        sql: `UPDATE ${quote(table)} SET ${park.map(([c, v]) => `${quote(c)} = ${v}`).join(", ")} WHERE "id" IN (${ids.map(() => "?").join(", ")})`,
        args: ids,
      });
    }
    for (let i = 0; i < upsert.length; i += ROWS_PER_STATEMENT) {
      const chunk = upsert.slice(i, i + ROWS_PER_STATEMENT);
      stmts.push({
        sql: upsertSql(table, sent, chunk.length),
        args: chunk.flatMap((r) => sent.map((c) => (r[c] ?? null) as InValue)),
      });
    }
  }

  for (const { id, reviewedAt } of reviews) {
    if (!plain(reviewedAt)) return "Day.reviewedAt isn't a plain value.";
    stmts.push({ sql: `UPDATE "Day" SET "reviewedAt" = ? WHERE "id" = ?`, args: [reviewedAt as InValue, id] });
  }

  const athleteCols = ATHLETE_COLUMNS.ExerciseRow;
  for (const edit of payload.athlete ?? []) {
    if (readOnly.get("ExerciseRow")?.has(edit.id)) continue;
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
  // An answer has to be to one of their questions too, or it could take another coach's slot.
  const questions = new Set([
    ...(owned.get("CheckinQuestion") ?? []),
    ...(tables.CheckinQuestion?.upsert ?? []).map((r) => String(r.id)),
  ]);
  // A moved session has to be one of theirs, as its id is named after it.
  const days = new Set([...(owned.get("Day") ?? []), ...(tables.Day?.upsert ?? []).map((r) => String(r.id))]);
  const notes: NewNote[] = [];
  const meetings: NewMeeting[] = [];
  for (const [table, all] of merged) {
    const cols = [...MERGED_COLUMNS[table]];
    const isNote = table === "CoachMessage";
    // Notes need only review; anything else under an athlete the coach can't edit is dropped.
    const mine = isNote ? (review.get(table) ?? new Set<string>()) : (owned.get(table) ?? new Set<string>());
    const list = all.filter(
      (r) => !readOnly.get("Athlete")?.has(String(r.athleteId)) || (isNote && review.get("Athlete")?.has(String(r.athleteId))),
    );
    if (list.length === 0) continue;
    const isMeeting = table === "Meeting";
    /** A note's text as the server had it, to tell a reworded note from a re-sent one. */
    const bodies = new Map<string, unknown>();
    /** Who wrote each message already here, for a row from an app that doesn't send it. */
    const senders = new Map<string, unknown>();
    /** A meeting as the server had it, to tell what the coach changed. */
    const before = new Map<string, Row>();
    for (const row of list) {
      if (!validMergedRow(table, row)) return `A ${table} row is missing something.`;
      if (!athletes.has(String(row.athleteId)) && !(isNote && review.get("Athlete")?.has(String(row.athleteId)))) return "That athlete isn't yours.";
      if (table === "CheckinAnswer" && !questions.has(String(row.questionId))) return "That question isn't yours.";
      if (table === "SessionMove" && !days.has(String(row.dayId))) return "That session isn't yours.";
    }
    const ids = list.map((r) => r.id);
    const held = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const hit = await rows(
        client,
        `SELECT "id", "updatedAt"${isNote ? `, "body", "sender"` : ""}${isMeeting ? `, "day", "time", "minutes", "timeZone", "place", "proposedBy", "status", "deletedAt"` : ""} FROM ${quote(table)} WHERE "id" IN (${chunk.map(() => "?").join(", ")})`,
        chunk,
      );
      for (const r of hit) {
        if (!mine.has(String(r.id))) return `${table} ${r.id} belongs to someone else.`;
        held.set(String(r.id), stampOf(r.updatedAt));
        if (isNote) {
          bodies.set(String(r.id), r.body);
          senders.set(String(r.id), r.sender);
        }
        if (isMeeting) before.set(String(r.id), r as Row);
      }
    }
    const fresh = newerRows(list, held);
    if (isNote) for (const r of fresh) r.sender ??= senders.get(String(r.id)) ?? "coach";
    if (isMeeting) {
      for (const r of fresh) {
        const news = meetingNews(before.get(String(r.id)), r);
        if (news) meetings.push({ id: String(r.id), athleteId: String(r.athleteId), day: String(r.day), time: String(r.time), news });
      }
    }
    if (isNote) {
      for (const r of fresh) {
        if (r.deletedAt || r.readAt || r.sender === "athlete") continue;
        if (held.has(String(r.id)) && bodies.get(String(r.id)) === r.body) continue;
        notes.push({ id: String(r.id), athleteId: String(r.athleteId), day: String(r.day), body: String(r.body) });
      }
    }
    for (let i = 0; i < fresh.length; i += ROWS_PER_STATEMENT) {
      const chunk = fresh.slice(i, i + ROWS_PER_STATEMENT);
      stmts.push({
        sql: upsertSql(table, cols, chunk.length),
        args: chunk.flatMap((r) => cols.map((c) => (r[c] ?? null) as InValue)),
      });
    }
  }

  if (stmts.length === 0) return null;

  // In the log for the coach's other computers and the coaches sharing the athlete, marked as this one's,
  // with the athlete each row is under: looked up as the push goes in, so a removed row is
  // logged before it goes and an added one once it's there.
  const logOf = (table: string, ids: string[]): InStatement[] => {
    const out: InStatement[] = [];
    const chain = athleteChain(table);
    for (let i = 0; i < ids.length; i += ROWS_PER_STATEMENT) {
      const chunk = ids.slice(i, i + ROWS_PER_STATEMENT);
      out.push(
        chain
          ? {
              sql:
                `INSERT INTO "PlanChange" ("coachId", "table", "rowId", "sessionId", "athleteId") ` +
                `SELECT ?, ?, t0."id", ?, ${chain.athlete} FROM ${chain.from} WHERE t0."id" IN (${chunk.map(() => "?").join(", ")})`,
              args: [coachId, table, sessionId, ...chunk],
            }
          : {
              sql: `INSERT INTO "PlanChange" ("coachId", "table", "rowId", "sessionId") VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")}`,
              args: chunk.flatMap((id) => [coachId, table, id, sessionId]),
            },
      );
    }
    return out;
  };
  const removals: InStatement[] = [];
  for (const { table } of SCOPE) {
    const change = tables[table];
    if (!change) continue;
    removals.push(...logOf(table, change.remove));
    stmts.push(...logOf(table, change.upsert.map((r) => String(r.id))));
  }
  stmts.push(...logOf("Day", reviews.map((r) => r.id)));
  stmts.unshift(...removals);

  // Whose plans this changes: removed rows are traced while they still exist, the rest once in.
  const plan = await planChanges(client, tables);
  const plans = new Set<string>();
  for (const [table, ids] of plan.removed) for (const id of await athletesOf(client, table, ids)) plans.add(id);

  // The coach's own edits to athlete data are news to any other computer they use, and to
  // the other coaches of those athletes.
  if ((payload.athlete ?? []).length > 0 || merged.length > 0) {
    const edited = new Set(merged.flatMap(([, list]) => list.map((r) => String(r.athleteId))));
    for (const id of await athletesOf(client, "ExerciseRow", (payload.athlete ?? []).map((e) => e.id))) edited.add(id);
    stmts.push(bumpAthleteVersion(coachId, [...edited]));
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
    for (const table of ["AthleteShare", "ShareCode"]) stmts.push(`DELETE FROM ${quote(table)} WHERE "athleteId" NOT IN (SELECT "id" FROM "Athlete")`);
  }

  await client.migrate(stmts);
  news.notes.push(...notes);
  news.meetings.push(...meetings);
  for (const [table, ids] of plan.upserted) for (const id of await athletesOf(client, table, ids)) plans.add(id);
  for (const id of plans) news.plans.add(id);
  return null;
}

/**
 * Erases a coach and everything that hangs off them — athletes, programs, what their
 * athletes logged — and their sign-ins, so the username is free again. Only athletes they
 * own: athletes others shared with them stay, and only the shares go. One transaction,
 * children first; the ids are picked while the parents they're found through still exist.
 */
export async function deleteCoach(client: Client, coachId: string): Promise<void> {
  const stmts: InStatement[] = [
    // Before the athletes go, while they still say whose phones these are.
    {
      sql: `DELETE FROM "PushSubscription" WHERE "athleteId" IN (SELECT "id" FROM "Athlete" WHERE "coachId" = ?)`,
      args: [coachId],
    },
  ];
  for (const { table } of [...SCOPE].reverse()) {
    if (table === "Coach") continue;
    stmts.push({ sql: `DELETE FROM ${quote(table)} WHERE "id" IN (${ownedIdsSql(table)})`, args: [coachId] });
  }
  stmts.push({ sql: `DELETE FROM "CoachSession" WHERE "coachId" = ?`, args: [coachId] });
  stmts.push({ sql: `DELETE FROM "AthleteShare" WHERE "coachId" = ? OR "athleteId" NOT IN (SELECT "id" FROM "Athlete")`, args: [coachId] });
  stmts.push({ sql: `DELETE FROM "ShareCode" WHERE "athleteId" NOT IN (SELECT "id" FROM "Athlete")`, args: [] });
  stmts.push({ sql: `DELETE FROM "Coach" WHERE "id" = ?`, args: [coachId] });
  await client.migrate(stmts);
}
