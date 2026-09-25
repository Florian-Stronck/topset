import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { serial } from "@/lib/serial";
import {
  ATHLETE_COLUMNS,
  athleteSignature,
  MERGED_COLUMNS,
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

/**
 * Local-first sync for the desktop app. The app only ever touches its local topset.db, so
 * every click is instant. In the background it talks to the Topset server as the signed-in
 * coach, never to the database itself:
 *
 * - up, every couple of seconds: whatever the coach changed;
 * - down, every few seconds and on Refresh: what their athletes logged.
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
  /** What was last sent up, per table: id → coach signature. Null until first compared. */
  sent: Map<string, Map<string, string>> | null;
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

  const s = state();
  s.sent = null;
  s.base = new Map();
  s.athleteVersion = null;
  s.merged = null;
  writeConfig({ ...config, seeded: true });
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
  if (!s.sent) {
    // First push since start: compare against what the server has, so anything deleted
    // here while offline, or before a restore, goes from the server too.
    const { tables: ids } = await api<{ tables: Record<string, Row[]> }>(config.server, "sync?part=ids", {
      token: config.token,
    });
    s.sent = new Map(names.map((t) => [t, new Map((ids[t] ?? []).map((r) => [String(r.id), ""]))]));
  }

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
    if (forcePull || Date.now() - s.lastPull >= PULL_EVERY_MS) await pull(config);
    await push(config, forcePull);
    s.lastSync = Date.now();
    s.error = null;
  } catch (error) {
    s.error = error instanceof Error ? error.message : String(error);
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

/** Forget what was sent, so the next push compares against the server afresh. */
export function resetSync(): void {
  const s = state();
  s.sent = null;
  s.base = new Map();
  s.athleteVersion = null;
  s.merged = null;
}
