import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import Database from "better-sqlite3";
import { clipFileName } from "@/lib/athlete-videos";
import { syncResetPath } from "@/lib/backup";
import { SCOPE } from "@/lib/coach-scope";
import { VERSION_HEADER } from "@/lib/desktop-version";
import { serial } from "@/lib/serial";
import {
  ATHLETE_COLUMNS,
  athleteSignature,
  coachSignature,
  MERGED_COLUMNS,
  PULL_ONLY_TABLES,
  logChanges,
  mergeAthleteColumns,
  newerRows,
  quote,
  stampOf,
  syncedColumns,
  syncedTable,
  tableChanges,
  type Row,
} from "@/lib/sync-plan";
import { markPhotoGone, photoFile, photoSettled, photosRoot } from "@/lib/photos";
import type { PlanData } from "@/lib/sync-server";
import { newVideoPath, readLedger, writeLedger } from "@/lib/videos";

/**
 * Local-first sync for the desktop app. The app only ever touches its local topset.db, so
 * every click is instant. In the background it talks to the Topset server as the signed-in
 * coach, never to the database itself:
 *
 * - up, every couple of seconds: whatever the coach changed;
 * - down, every few seconds and on Refresh: what their athletes logged, and plan changes
 *   made on the coach's other computers.
 *
 * What was last sent is kept in the database (SyncSent), so a restart knows exactly what
 * changed or was deleted here. A row this computer never had is never deleted from the
 * server: it comes down instead. Two computers editing the same row: the last push wins.
 *
 * Offline is fine: sync fails quietly and catches up when the connection is back.
 */

const TICK_MS = 2000;
const PULL_EVERY_MS = 8000;
/** Rows per request, well under the server's body limit. */
const ROWS_PER_REQUEST = 3000;

/** What signing in leaves beside topset.db (topset-cloud.json). */
export type CloudConfig = {
  server: string;
  token: string;
  coachId: string;
  username: string;
  name: string;
  isAdmin: boolean;
  /** This computer's data has been matched up with the server's once. */
  seeded?: boolean;
};

type State = {
  local: Database.Database | null;
  /** What was last sent up, per table: id → coach signature. Null until loaded or worked out. */
  sent: Map<string, Map<string, string>> | null;
  /** Make the server match this computer, deletes and all (Sync everything, or a restore). */
  takeOver: boolean;
  /** Where the server's plan log stood when a take-over started; kept once it has gone up. */
  takeOverRev: number | null;
  /** Athlete columns both sides last agreed on, per row id. */
  base: Map<string, string>;
  /** The server's athlete-data version this copy last took in full; null until then. */
  athleteVersion: number | null;
  /**
   * Merged tables (weigh-ins, check-in answers) as the server has them, table → id → updatedAt in
   * ms: what the last full pull saw, plus what was pushed since. Null until a pull brings
   * them (or from an older server).
   */
  merged: Map<string, Map<string, number>> | null;
  /** SQLite's change counter for other connections: Prisma's writes bump it, ours don't. */
  dataVersion: number;
  queue: ReturnType<typeof serial>;
  lastPull: number;
  lastSync: number | null;
  error: string | null;
  timer: ReturnType<typeof setInterval> | null;
};

const g = globalThis as unknown as { __topsetSync?: State };

function state(): State {
  g.__topsetSync ??= {
    local: null,
    sent: null,
    takeOver: false,
    takeOverRev: null,
    base: new Map(),
    athleteVersion: null,
    merged: null,
    dataVersion: -1,
    queue: serial(),
    lastPull: 0,
    lastSync: null,
    error: null,
    timer: null,
  };
  return g.__topsetSync;
}

// --- config ---------------------------------------------------------------------------

function configFile(): string | null {
  return process.env.TOPSET_CLOUD_FILE || null;
}

export function readConfig(): CloudConfig | null {
  const file = configFile();
  if (!file) return null;
  try {
    const c = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
    if (typeof c.server !== "string" || typeof c.token !== "string" || !c.token) return null;
    // Signed in before usernames: the server renamed the account to the part before the @.
    if (typeof c.username !== "string") c.username = String(c.email ?? "").split("@")[0];
    return c as CloudConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: CloudConfig | null): void {
  const file = configFile();
  if (!file) throw new Error("Only the desktop app can sign in.");
  if (config) fs.writeFileSync(/*turbopackIgnore: true*/ file, JSON.stringify(config, null, 2));
  else fs.rmSync(/*turbopackIgnore: true*/ file, { force: true });
}

export function syncEnabled(): boolean {
  return readConfig() !== null;
}

export function syncStatus(): { lastSync: number | null; error: string | null } {
  const s = state();
  return { lastSync: s.lastSync, error: s.error };
}

// --- talking to the server ------------------------------------------------------------

export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One call to the Topset server's coach API. */
export async function api<T>(
  server: string,
  route: string,
  { method = "GET", token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server.replace(/\/+$/, "")}/api/coach/${route}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(process.env.TOPSET_APP_VERSION ? { [VERSION_HEADER]: process.env.TOPSET_APP_VERSION } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ServerError("Can't reach the Topset server. Check the address and your internet.", 0);
  }
  const data = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
  if (!res.ok || !data || data.ok === false) {
    const fallback = res.status === 404 ? "That address isn't a Topset server." : `The server answered ${res.status}.`;
    throw new ServerError(data?.error ?? fallback, res.status);
  }
  return data;
}

// --- local database -------------------------------------------------------------------

function localPath(): string {
  return path.resolve((process.env.DATABASE_URL ?? "").replace(/^file:/, ""));
}

function local(): Database.Database {
  const s = state();
  s.local ??= new Database(localPath());
  return s.local;
}

function tables(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[])
    .map((t) => t.name)
    .filter(syncedTable);
}

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((c) => c.name);
}

function insertAll(db: Database.Database, table: string, rows: Row[]) {
  if (rows.length === 0) return;
  // Only the columns the rows carry; the rest (a coach's isAdmin, say) take their defaults.
  const cols = columnsOf(db, table).filter((c) => c in rows[0]);
  const insert = db.prepare(
    `INSERT INTO ${quote(table)} (${cols.map(quote).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  );
  for (const row of rows) insert.run(...cols.map((c) => row[c] ?? null));
}

// --- what this computer last sent, and how far it has read the server's plan log -------

type Sent = Map<string, Map<string, string>>;

const PLAN_REV = "planRev";

function readMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT "value" FROM "SyncMeta" WHERE "key" = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeMeta(db: Database.Database, key: string, value: string | null): void {
  if (value === null) db.prepare(`DELETE FROM "SyncMeta" WHERE "key" = ?`).run(key);
  else db.prepare(`INSERT OR REPLACE INTO "SyncMeta" ("key", "value") VALUES (?, ?)`).run(key, value);
}

function loadSent(db: Database.Database): Sent {
  const sent: Sent = new Map();
  for (const r of db.prepare(`SELECT "table", "id", "sig" FROM "SyncSent"`).all() as { table: string; id: string; sig: string }[]) {
    let t = sent.get(r.table);
    if (!t) sent.set(r.table, (t = new Map()));
    t.set(r.id, r.sig);
  }
  return sent;
}

/** Writes what changed between two versions of `sent`. Call inside a transaction. */
function saveSent(db: Database.Database, before: Sent, after: Sent): void {
  const put = db.prepare(`INSERT OR REPLACE INTO "SyncSent" ("table", "id", "sig") VALUES (?, ?, ?)`);
  const drop = db.prepare(`DELETE FROM "SyncSent" WHERE "table" = ? AND "id" = ?`);
  for (const table of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(table) ?? new Map<string, string>();
    const now = after.get(table) ?? new Map<string, string>();
    for (const [id, sig] of now) if (was.get(id) !== sig) put.run(table, id, sig);
    for (const id of was.keys()) if (!now.has(id)) drop.run(table, id);
  }
}

/** Forgets what was sent and read, so the next sync works it out afresh. */
function forgetSent(db: Database.Database): void {
  db.prepare(`DELETE FROM "SyncSent"`).run();
  writeMeta(db, PLAN_REV, null);
}

/** Synced tables of the local database, parents before children. */
function inOrder(names: string[]): string[] {
  const scoped = SCOPE.map((s) => s.table).filter((t) => names.includes(t));
  return [...scoped, ...names.filter((t) => !scoped.includes(t))];
}

// --- the steps --------------------------------------------------------------------------

/**
 * The first sync after signing in on this computer. If the account already has athletes
 * on the server, the server is the truth: this computer's data is kept as a backup and
 * replaced with the account's. Otherwise this computer's data becomes the account's and
 * goes up with the first push.
 */
async function seed(config: CloudConfig): Promise<void> {
  const db = local();
  const { tables: remote } = await api<{ tables: Record<string, Row[]> }>(config.server, "sync?part=snapshot", {
    token: config.token,
  });

  db.pragma("foreign_keys = OFF");
  try {
    if ((remote.Athlete ?? []).length > 0) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const keep = path.join(path.dirname(localPath()), "topset-backups", `topset-before-sign-in-${stamp}.db`);
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      db.prepare("VACUUM INTO ?").run(keep);

      const all = [...tables(db), "SetLog", ...Object.keys(MERGED_COLUMNS)];
      db.transaction(() => {
        for (const t of all) db.prepare(`DELETE FROM ${quote(t)}`).run();
        for (const t of all) {
          const rows = remote[t] ?? [];
          // The server doesn't hand out login details; the local Coach row keeps the username.
          insertAll(db, t, t === "Coach" ? rows.map((r) => ({ ...r, username: config.username })) : rows);
        }
      })();
      console.log(`[topset] signed in: took ${config.username}'s data; this computer's copy is in ${keep}`);
    } else {
      // This computer's coach becomes the account's coach, under the account's id.
      db.transaction(() => {
        const current = db.prepare(`SELECT "id" FROM "Coach" LIMIT 1`).get() as { id: string } | undefined;
        if (current && current.id !== config.coachId) {
          db.prepare(`UPDATE "Coach" SET "id" = ?, "username" = ? WHERE "id" = ?`).run(config.coachId, config.username, current.id);
          db.prepare(`UPDATE "Athlete" SET "coachId" = ?`).run(config.coachId);
        } else if (!current) {
          db.prepare(`INSERT INTO "Coach" ("id", "username", "name") VALUES (?, ?, ?)`).run(config.coachId, config.username, config.name);
        }
        // A name never changed from the default gives way to the one on the account.
        db.prepare(`UPDATE "Coach" SET "name" = ? WHERE "id" = ? AND "name" IN ('', 'Coach')`).run(config.name, config.coachId);
      })();
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }

  // Worked out afresh against the server's copy on the next sync (see `baseline`).
  forgetSent(db);
  const s = state();
  s.sent = null;
  s.base = new Map();
  s.athleteVersion = null;
  s.merged = null;
  writeConfig({ ...config, seeded: true });
}

/**
 * Where this computer stands against the server, before anything else syncs: what it last
 * sent, as kept in SyncSent. Without that (the first sync of this version, or after signing
 * in), the server's copy is merged in: rows only the server has come down, rows only this
 * computer has go up, and a row both have keeps this computer's version. To take over
 * instead (Sync everything, a restored backup), everything here goes up and whatever isn't
 * here goes from the server.
 */
async function baseline(config: CloudConfig): Promise<void> {
  const s = state();
  const db = local();
  const reset = syncResetPath();
  if (fs.existsSync(reset)) s.takeOver = true;

  if (!s.takeOver && readMeta(db, PLAN_REV) !== null) {
    s.sent = loadSent(db);
    return;
  }

  if (s.takeOver) {
    const { tables: ids, rev } = await api<{ tables: Record<string, Row[]>; rev?: number }>(config.server, "sync?part=ids", {
      token: config.token,
    });
    s.sent = new Map(tables(db).map((t) => [t, new Map((ids[t] ?? []).map((r) => [String(r.id), ""]))]));
    // Written with the first push, once it has gone through.
    s.takeOverRev = rev ?? 0;
    return;
  }

  const { tables: remote, rev } = await api<{ tables: Record<string, Row[]>; rev?: number }>(config.server, "sync?part=snapshot", {
    token: config.token,
  });
  const sent: Sent = new Map();
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      for (const t of inOrder(tables(db))) {
        const cols = columnsOf(db, t);
        const here = new Set((db.prepare(`SELECT "id" FROM ${quote(t)}`).all() as Row[]).map((r) => String(r.id)));
        const theirs = remote[t] ?? [];
        const missing = theirs.filter((r) => !here.has(String(r.id)));
        insertAll(db, t, t === "Coach" ? [] : missing);
        sent.set(t, new Map(theirs.map((r) => [String(r.id), coachSignature(t, r, cols)])));
      }
      forgetSent(db);
      saveSent(db, new Map(), sent);
      writeMeta(db, PLAN_REV, String(rev ?? 0));
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  s.sent = sent;
}

/**
 * Plan changes from the coach's other computers, applied here. A row edited here and not
 * yet sent keeps this computer's version, which goes up next and wins; a row deleted there
 * goes here too, with everything under it.
 */
async function pullPlan(config: CloudConfig): Promise<void> {
  const s = state();
  const db = local();
  // Taking over: the server is about to be made to match this computer, not the other way.
  if (!s.sent || s.takeOver) return;
  for (;;) {
    const since = Number(readMeta(db, PLAN_REV) ?? 0);
    const data = await api<PlanData>(config.server, `sync?part=plan&since=${since}`, { token: config.token });
    const sent = s.sent;
    db.transaction(() => {
      const before: Sent = new Map([...sent].map(([t, m]) => [t, new Map(m)]));
      applyPlan(db, data, sent);
      saveSent(db, before, sent);
      writeMeta(db, PLAN_REV, String(data.rev));
    })();
    if (!data.more) return;
  }
}

/** The pure-database half of `pullPlan`, apart for testing. Changes `sent` to match. */
export function applyPlan(db: Database.Database, data: Pick<PlanData, "rows" | "removed">, sent: Sent): void {
  const names = new Set(tables(db));
  for (const { table } of [...SCOPE].reverse()) {
    const ids = data.removed[table];
    if (!ids || !names.has(table) || table === "Coach") continue;
    const drop = db.prepare(`DELETE FROM ${quote(table)} WHERE "id" = ?`);
    for (const id of ids) {
      drop.run(id);
      sent.get(table)?.delete(id);
    }
  }
  for (const { table } of SCOPE) {
    const list = data.rows[table];
    if (!list || !names.has(table)) continue;
    const cols = columnsOf(db, table);
    const athlete = ATHLETE_COLUMNS[table] ?? [];
    const read = db.prepare(`SELECT * FROM ${quote(table)} WHERE "id" = ?`);
    let mine = sent.get(table);
    if (!mine) sent.set(table, (mine = new Map()));
    for (const row of list) {
      const held = read.get(row.id) as Row | undefined;
      // An edit here waiting to go up.
      if (held && coachSignature(table, held, cols) !== mine.get(row.id)) continue;
      // Only columns both sides have; the athlete's own ones are for the athlete pull.
      const given = cols.filter((c) => c in row && (!held || !athlete.includes(c)) && (table !== "Coach" || c === "name" || c === "settings"));
      try {
        if (held) {
          const set = given.filter((c) => c !== "id");
          if (set.length) db.prepare(`UPDATE ${quote(table)} SET ${set.map((c) => `${quote(c)} = ?`).join(", ")} WHERE "id" = ?`).run(...set.map((c) => row[c] ?? null), row.id);
        } else if (table !== "Coach") {
          db.prepare(`INSERT INTO ${quote(table)} (${given.map(quote).join(", ")}) VALUES (${given.map(() => "?").join(", ")})`).run(...given.map((c) => row[c] ?? null));
        } else continue;
      } catch {
        // Under something deleted here and not yet sent: that delete goes up and wins.
        continue;
      }
      mine.set(row.id, coachSignature(table, read.get(row.id) as Row, cols));
    }
  }
}

/** Athlete data down: SetLog wholesale, and the athlete columns row by row. */
async function pull(config: CloudConfig): Promise<void> {
  const s = state();
  const db = local();
  // Asking with the version already held costs the server one row when nothing is new.
  const since = s.athleteVersion === null ? "" : `&since=${s.athleteVersion}`;
  const data = await api<{ unchanged?: boolean; version?: number; logs: Row[]; rows: Row[]; merged?: Record<string, Row[]> }>(
    config.server,
    `sync?part=athlete${since}`,
    { token: config.token },
  );
  if (data.unchanged) {
    s.lastPull = Date.now();
    return;
  }
  const { logs, rows } = data;
  const merged = data.merged && typeof data.merged === "object" ? data.merged : null;

  const cols = ATHLETE_COLUMNS.ExerciseRow;
  const localRows = new Map(
    (db.prepare(`SELECT "id", ${cols.map(quote).join(", ")} FROM "ExerciseRow"`).all() as Row[]).map((r) => [r.id, r]),
  );
  const logCols = columnsOf(db, "SetLog");
  const localLogs = db.prepare(`SELECT * FROM "SetLog"`).all() as Row[];
  const known = logs.filter((l) => localRows.has(String(l.rowId)));
  const changes = logChanges(localLogs, known, logCols);
  const update = db.prepare(`UPDATE "ExerciseRow" SET ${cols.map((c) => `${quote(c)} = ?`).join(", ")} WHERE "id" = ?`);

  db.transaction(() => {
    for (const row of rows) {
      const mine = localRows.get(row.id);
      if (!mine) continue;
      const merge = mergeAthleteColumns(athleteSignature("ExerciseRow", mine), athleteSignature("ExerciseRow", row), s.base.get(row.id));
      if (merge.take) update.run(...cols.map((c) => row[c] ?? null), row.id);
      // A coach edit waiting to go up keeps its old base, so push still sees it.
      if (!merge.send) s.base.set(row.id, merge.base);
    }
    const drop = db.prepare(`DELETE FROM "SetLog" WHERE "id" = ?`);
    for (const id of changes.remove) drop.run(id);
    insertAll(db, "SetLog", changes.insert);
    for (const table of Object.keys(MERGED_COLUMNS)) {
      if (Array.isArray(merged?.[table])) takeMerged(db, table, merged[table]);
    }
  })();
  s.merged = merged
    ? new Map(
        Object.keys(MERGED_COLUMNS).map((table) => [
          table,
          new Map((merged[table] ?? []).map((r) => [r.id, stampOf(r.updatedAt)])),
        ]),
      )
    : null;
  // A server from before versions sends none, and is asked in full every time.
  s.athleteVersion = typeof data.version === "number" ? data.version : null;
  s.lastPull = Date.now();
}

/**
 * The server's rows of a merged table into the local copy: rows new here, or edited there
 * after the copy here was. A local edit newer than the server's stays, and goes up with
 * the next push.
 */
function takeMerged(db: Database.Database, table: string, remote: Row[]) {
  const cols = MERGED_COLUMNS[table];
  const athletes = new Set((db.prepare(`SELECT "id" FROM "Athlete"`).all() as Row[]).map((r) => r.id));
  const held = new Map(
    (db.prepare(`SELECT "id", "updatedAt" FROM ${quote(table)}`).all() as Row[]).map((r) => [r.id, stampOf(r.updatedAt)]),
  );
  const take = newerRows(remote, held).filter((r) => athletes.has(String(r.athleteId)));
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO ${quote(table)} (${cols.map(quote).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  );
  for (const row of take) upsert.run(...cols.map((c) => row[c] ?? null));
}

type Push = {
  tables: Record<string, { upsert: Row[]; remove: string[] }>;
  athlete: { id: string; values: Row }[];
  merged?: Record<string, Row[]>;
};

/** Coach data up: only what changed since the last push. */
async function push(config: CloudConfig, force: boolean): Promise<void> {
  const s = state();
  const db = local();
  const version = Number(db.pragma("data_version", { simple: true }));
  if (!force && s.sent && version === s.dataVersion) return;

  const names = tables(db);
  if (!s.sent) return;

  const next = new Map<string, Map<string, string>>();
  const agreed = new Map<string, string>();
  const payload: Push = { tables: {}, athlete: [] };

  for (const t of names) {
    const cols = columnsOf(db, t);
    const sentCols = syncedColumns(t, cols);
    const rows = db.prepare(`SELECT * FROM ${quote(t)}`).all() as Row[];
    const changes = tableChanges(t, rows, cols, s.sent.get(t) ?? new Map());
    next.set(t, changes.signatures);
    if (changes.upsert.length || changes.remove.length) {
      payload.tables[t] = {
        upsert: changes.upsert.map((r) => Object.fromEntries(sentCols.map((c) => [c, r[c] ?? null])) as Row),
        remove: changes.remove,
      };
    }

    // The coach's own edits to athlete columns (the Tracking sheet).
    const athleteCols = ATHLETE_COLUMNS[t];
    if (athleteCols) {
      const before = s.sent.get(t);
      for (const row of rows) {
        const base = s.base.get(row.id);
        const mine = athleteSignature(t, row);
        // A row new to the server goes up whole, so both sides start out agreeing on it;
        // pulls that find nothing new would otherwise never give it a base.
        if (base === undefined && !before?.has(row.id)) agreed.set(row.id, mine);
        if (base === undefined || mine === base) continue;
        payload.athlete.push({ id: row.id, values: Object.fromEntries(athleteCols.map((c) => [c, row[c] ?? null])) as Row });
        agreed.set(row.id, mine);
      }
    }
  }

  // Merged rows added, changed or deleted here since the server last had them. Only once
  // a pull has said what the server holds, so nothing is sent blind.
  const outgoing: Record<string, Row[]> = {};
  for (const [table, cols] of Object.entries(MERGED_COLUMNS)) {
    if (PULL_ONLY_TABLES.has(table)) continue;
    const held = s.merged?.get(table);
    if (!held) continue;
    const fresh = newerRows(db.prepare(`SELECT ${cols.map(quote).join(", ")} FROM ${quote(table)}`).all() as Row[], held);
    if (fresh.length > 0) outgoing[table] = fresh;
  }
  if (Object.keys(outgoing).length > 0) payload.merged = outgoing;

  // Large first uploads go in parts, parents before children; each part is checked on
  // its own, which works because a parent is already there by the time its children come.
  for (const part of split(payload)) {
    await api(config.server, "sync", { method: "POST", token: config.token, body: part });
  }
  for (const [id, sig] of agreed) s.base.set(id, sig);
  for (const [table, list] of Object.entries(outgoing)) {
    for (const row of list) s.merged?.get(table)?.set(row.id, stampOf(row.updatedAt));
  }
  const before = s.sent;
  db.transaction(() => {
    saveSent(db, before, next);
    if (s.takeOverRev !== null) writeMeta(db, PLAN_REV, String(s.takeOverRev));
  })();
  if (s.takeOver) {
    s.takeOver = false;
    s.takeOverRev = null;
    fs.rmSync(syncResetPath(), { force: true });
  }
  s.sent = next;
  s.dataVersion = version;
}

const ORDER = ["Coach", "Athlete", "Program", "Meet", "Block", "Attempt", "Week", "Day", "ExerciseRow", "ProgressionRule"];

function split(payload: Push): Push[] {
  const count = Object.values(payload.tables).reduce((n, t) => n + t.upsert.length + t.remove.length, 0);
  const mergedCount = Object.values(payload.merged ?? {}).reduce((n, list) => n + list.length, 0);
  if (count + payload.athlete.length + mergedCount === 0) return [];
  if (count <= ROWS_PER_REQUEST) return [payload];

  const parts: Push[] = [];
  let current: Push = { tables: {}, athlete: [] };
  let size = 0;
  const flush = () => {
    if (size > 0) parts.push(current);
    current = { tables: {}, athlete: [] };
    size = 0;
  };
  const tableNames = [
    ...ORDER.filter((t) => payload.tables[t]),
    ...Object.keys(payload.tables).filter((t) => !ORDER.includes(t)),
  ];
  for (const t of tableNames) {
    for (const row of payload.tables[t].upsert) {
      (current.tables[t] ??= { upsert: [], remove: [] }).upsert.push(row);
      if (++size >= ROWS_PER_REQUEST) flush();
    }
  }
  flush();
  // Removals last, all together, with the athlete edits and merged rows — by then every
  // athlete they hang off is up.
  const last: Push = { tables: {}, athlete: payload.athlete, merged: payload.merged };
  for (const t of tableNames) {
    if (payload.tables[t].remove.length) last.tables[t] = { upsert: [], remove: payload.tables[t].remove };
  }
  parts.push(last);
  return parts;
}

async function cycle(forcePull: boolean): Promise<void> {
  const s = state();
  const config = readConfig();
  if (!config) return;
  try {
    if (!config.seeded) {
      await seed(config);
      forcePull = true;
    }
    if (!s.sent) {
      await baseline(config);
      forcePull = true;
    }
    if (forcePull || Date.now() - s.lastPull >= PULL_EVERY_MS) {
      await pull(config);
      await pullPlan(config);
    }
    await push(config, forcePull);
    s.lastSync = Date.now();
    s.error = null;
    // Alongside, not in the queue: a big download mustn't hold up the next sync.
    void fetchClips(config);
    void fetchPhotos(config);
  } catch (error) {
    s.error = error instanceof Error ? error.message : String(error);
  }
}

// --- videos from the athlete app ------------------------------------------------------

/** How often to look for videos to download; each look is one local query. */
const CLIPS_EVERY_MS = 30_000;
/** Storage keeps videos for weeks, not months: an older one isn't worth asking for. */
const CLIP_MAX_AGE_DAYS = 90;

const clipState = globalThis as unknown as { __topsetClips?: { busy: boolean; last: number } };

/**
 * Downloads the videos athletes sent that this computer doesn't have yet into the videos
 * folder, beside the ones the coach dropped in themselves, so Tracking shows them with the
 * exercise. One at a time; a failure leaves the rest for next time.
 */
async function fetchClips(config: CloudConfig): Promise<void> {
  const st = (clipState.__topsetClips ??= { busy: false, last: 0 });
  if (st.busy || Date.now() - st.last < CLIPS_EVERY_MS) return;
  st.busy = true;
  st.last = Date.now();
  try {
    const db = local();
    const since = new Date(Date.now() - CLIP_MAX_AGE_DAYS * 86_400_000).toISOString();
    const ledger = readLedger();
    const waiting = (
      db
        .prepare(
          `SELECT v."id", v."rowId", v."day", v."setIndex", v."name", v."contentType", v."uploadedAt", r."exercise"
           FROM "AthleteVideo" v LEFT JOIN "ExerciseRow" r ON r."id" = v."rowId"
           WHERE v."uploadedAt" IS NOT NULL AND v."deletedAt" IS NULL ORDER BY v."uploadedAt"`,
        )
        .all() as Row[]
    ).filter((v) => !(v.id in ledger) && new Date(stampOf(v.uploadedAt)).toISOString() >= since);
    if (waiting.length === 0) return;

    const { urls } = await api<{ urls: Record<string, string> }>(config.server, "videos", {
      method: "POST",
      token: config.token,
      body: { ids: waiting.slice(0, 20).map((v) => v.id) },
    });
    for (const v of waiting.slice(0, 20)) {
      const url = urls[v.id];
      if (!url) continue;
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 404) {
        ledger[v.id] = null;
        writeLedger(ledger);
        continue;
      }
      if (!res.ok || !res.body) break;
      const set = typeof v.setIndex === "number" || typeof v.setIndex === "bigint" ? Number(v.setIndex) : null;
      const name = clipFileName(String(v.day), String(v.exercise ?? ""), String(v.name), String(v.contentType), set);
      const file = newVideoPath(String(v.rowId), name);
      if (!file) {
        ledger[v.id] = null;
        writeLedger(ledger);
        continue;
      }
      const partial = `${file}.part`;
      try {
        await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), fs.createWriteStream(partial));
        fs.renameSync(partial, file);
      } catch {
        fs.rmSync(partial, { force: true });
        break;
      }
      ledger[v.id] = path.basename(file);
      writeLedger(ledger);
    }
  } catch (error) {
    console.warn("[topset] couldn't download athlete videos:", error instanceof Error ? error.message : error);
  } finally {
    st.busy = false;
  }
}

const photoState = globalThis as unknown as { __topsetPhotos?: { busy: boolean; last: number } };

/**
 * Downloads the check-in photos athletes sent that this computer doesn't have yet, the way
 * `fetchClips` does videos. Storage lets them go after a few weeks; the copy here stays.
 */
async function fetchPhotos(config: CloudConfig): Promise<void> {
  const st = (photoState.__topsetPhotos ??= { busy: false, last: 0 });
  if (st.busy || Date.now() - st.last < CLIPS_EVERY_MS) return;
  st.busy = true;
  st.last = Date.now();
  try {
    const since = new Date(Date.now() - CLIP_MAX_AGE_DAYS * 86_400_000).toISOString();
    const waiting = (
      local()
        .prepare(`SELECT "id", "uploadedAt" FROM "CheckinPhoto" WHERE "uploadedAt" IS NOT NULL AND "deletedAt" IS NULL ORDER BY "uploadedAt"`)
        .all() as Row[]
    )
      .filter((p) => new Date(stampOf(p.uploadedAt)).toISOString() >= since && !photoSettled(p.id))
      .slice(0, 50);
    if (waiting.length === 0) return;

    const { urls } = await api<{ urls: Record<string, string> }>(config.server, "videos", {
      method: "POST",
      token: config.token,
      body: { ids: waiting.map((p) => p.id) },
    });
    fs.mkdirSync(photosRoot(), { recursive: true });
    for (const { id } of waiting) {
      if (!urls[id]) continue;
      const res = await fetch(urls[id], { cache: "no-store" });
      if (res.status === 404) {
        markPhotoGone(id);
        continue;
      }
      if (!res.ok) break;
      const file = photoFile(id);
      fs.writeFileSync(`${file}.part`, new Uint8Array(await res.arrayBuffer()));
      fs.renameSync(`${file}.part`, file);
    }
  } catch (error) {
    console.warn("[topset] couldn't download check-in photos:", error instanceof Error ? error.message : error);
  } finally {
    st.busy = false;
  }
}

/** One sync at a time; a Refresh during a background sync waits for it, then goes. */
function run(forcePull: boolean): Promise<void> {
  return state().queue.run(() => cycle(forcePull));
}

/** Starts the background sync; safe to call again (after signing in, say). */
export function startSync(): void {
  const s = state();
  if (!syncEnabled()) return;
  if (!s.timer) {
    s.timer = setInterval(() => {
      if (!s.queue.busy() && syncEnabled()) void run(false);
    }, TICK_MS);
  }
  void run(true);
}

/** Stops syncing and forgets this session's bookkeeping, on signing out. */
export function stopSync(): void {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
  s.sent = null;
  s.takeOver = false;
  s.takeOverRev = null;
  s.base = new Map();
  s.athleteVersion = null;
  s.lastSync = null;
  s.merged = null;
  s.error = null;
}

/** Refresh: bring athlete logs down and changes up, now. */
export async function syncNow(): Promise<{ lastSync: number | null; error: string | null }> {
  if (!syncEnabled()) return syncStatus();
  await run(true);
  return syncStatus();
}

/** Sync everything: the next push makes the server match this computer, deletes and all. */
export function resetSync(): void {
  const s = state();
  s.sent = null;
  s.takeOver = true;
  s.base = new Map();
  s.athleteVersion = null;
  s.merged = null;
}
