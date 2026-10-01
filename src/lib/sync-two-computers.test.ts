import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { createClient, type Client } from "@libsql/client";
import { migrateRemote } from "@/lib/cloud";
import { syncNow } from "@/lib/sync";
import { applyPush, athleteData, planData, planRev, snapshot } from "@/lib/sync-server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { migrate } = require("../../electron/migrate.js") as { migrate: (db: Database.Database, dir: string) => void };

/**
 * One coach, two computers, one server — all in this process. Each computer is its own
 * database, sign-in file and sync state; `switchTo` switches between them. Requests go straight
 * to the server's functions instead of over the network.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topset-two-computers-"));
let server: Client;

type Computer = { name: string; db: string; config: string; state?: unknown };
const computers: Computer[] = [];
const g = globalThis as unknown as { __topsetSync?: unknown };

function computer(name: string): Computer {
  // A folder each, as on two real computers: what sits beside the database is theirs alone.
  const home = path.join(dir, name);
  fs.mkdirSync(home);
  const c: Computer = { name, db: path.join(home, "topset.db"), config: path.join(home, "topset-cloud.json") };
  const db = new Database(c.db);
  db.pragma("journal_mode = WAL");
  migrate(db, path.join("prisma", "migrations"));
  db.prepare(`INSERT INTO "Coach" ("id", "username", "name") VALUES ('me', 'me', 'Me')`).run();
  db.close();
  fs.writeFileSync(c.config, JSON.stringify({ server: "http://topset.test", token: name, coachId: "me", username: "me", name: "Me", isAdmin: false, seeded: true }));
  computers.push(c);
  return c;
}

function switchTo(c: Computer) {
  process.env.DATABASE_URL = `file:${c.db}`;
  process.env.TOPSET_CLOUD_FILE = c.config;
  g.__topsetSync = c.state;
}

async function sync(c: Computer) {
  switchTo(c);
  const { error } = await syncNow();
  c.state = g.__topsetSync;
  assert.equal(error, null, `${c.name}: ${error}`);
}

/** Quits the app: the next sync starts from nothing but what is on disk. */
function restart(c: Computer) {
  (c.state as { local: Database.Database | null } | undefined)?.local?.close();
  c.state = undefined;
}

function sql(c: Computer, statement: string, ...args: unknown[]) {
  const db = new Database(c.db);
  try {
    db.prepare(statement).run(...args);
  } finally {
    db.close();
  }
}

function one(file: string, statement: string): unknown {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare(statement).get() as Record<string, unknown> | undefined) ?? null;
  } finally {
    db.close();
  }
}

async function onServer(statement: string) {
  return (await server.execute(statement)).rows[0] ?? null;
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

before(async () => {
  server = createClient({ url: `file:${path.join(dir, "server.db").replace(/\\/g, "/")}` });
  await migrateRemote(server, path.join("prisma", "migrations"));
  await server.execute(`INSERT INTO "Coach" ("id", "username", "name") VALUES ('me', 'me', 'Me')`);

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const session = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace("Bearer ", "");
    if (url.pathname === "/api/coach/videos") return reply({ ok: true, urls: {} });
    if (url.pathname !== "/api/coach/sync") return reply({ ok: false, error: "Not here." }, 404);
    if (init?.method === "POST") {
      const problem = await applyPush(server, "me", JSON.parse(String(init.body)), undefined, session);
      return problem ? reply({ ok: false, error: problem }, 422) : reply({ ok: true });
    }
    const part = url.searchParams.get("part");
    const since = url.searchParams.get("since");
    if (part === "athlete") return reply({ ok: true, ...(await athleteData(server, "me", since === null ? undefined : Number(since))) });
    // A server from before teams, as this coach is on none.
    if (part === "access" || part === "athletes") return reply({ ok: false, error: "Unknown part." }, 400);
    if (part === "plan") return reply({ ok: true, ...(await planData(server, "me", session, Number(since))) });
    const rev = await planRev(server);
    return reply({ ok: true, rev, tables: await snapshot(server, "me", part === "ids") });
  }) as typeof fetch;
});

after(() => {
  for (const c of computers) restart(c);
  server.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});

const a = () => computers[0];
const b = () => computers[1];

test("the second computer takes the first one's plan instead of deleting it", async () => {
  computer("laptop");
  computer("office");
  sql(a(), `INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('a1', 'me', 'Ann')`);
  sql(a(), `INSERT INTO "Program" ("id", "athleteId", "name") VALUES ('p1', 'a1', 'Plan')`);
  sql(a(), `INSERT INTO "Block" ("id", "athleteId", "programId", "phase", "startDate") VALUES ('b1', 'a1', 'p1', 'Base', 0)`);
  sql(a(), `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w1', 'b1', 1), ('w2', 'b1', 2)`);
  sql(a(), `INSERT INTO "Day" ("id", "weekId", "index", "label") VALUES ('d1', 'w1', 0, 'Mon'), ('d2', 'w2', 0, 'Mon')`);
  sql(a(), `INSERT INTO "ExerciseRow" ("id", "dayId", "order", "target", "exercise") VALUES ('r1', 'd1', 0, 'Squat', 'Squat'), ('r2', 'd2', 0, 'Squat', 'Squat')`);
  await sync(a());
  assert.ok(await onServer(`SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r2'`));

  await sync(b());
  assert.ok(await onServer(`SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r2'`), "still on the server");
  assert.ok(one(b().db, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r2'`), "and now on the office computer");
});

test("an edit on one computer reaches the other", async () => {
  sql(b(), `UPDATE "ExerciseRow" SET "exercise" = 'Front squat' WHERE "id" = 'r1'`);
  await sync(b());
  await sync(a());
  assert.deepEqual(one(a().db, `SELECT "exercise" FROM "ExerciseRow" WHERE "id" = 'r1'`), { exercise: "Front squat" });
});

test("a delete on one computer reaches the other, with everything under it", async () => {
  const db = new Database(a().db);
  db.pragma("foreign_keys = ON");
  db.prepare(`DELETE FROM "Week" WHERE "id" = 'w2'`).run();
  db.close();
  await sync(a());
  await sync(b());
  assert.equal(one(b().db, `SELECT 1 FROM "Week" WHERE "id" = 'w2'`), null);
  assert.equal(one(b().db, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r2'`), null);
  // The office computer's next push must not trip over rows that went with the week.
  await sync(b());
});

test("after a restart, rows the other computer made meanwhile stay, and a delete made while closed still goes up", async () => {
  restart(b());
  sql(a(), `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w3', 'b1', 3)`);
  await sync(a());
  sql(b(), `DELETE FROM "ExerciseRow" WHERE "id" = 'r1'`);

  await sync(b());
  assert.ok(await onServer(`SELECT 1 FROM "Week" WHERE "id" = 'w3'`), "the laptop's new week survives");
  assert.ok(one(b().db, `SELECT 1 FROM "Week" WHERE "id" = 'w3'`), "and comes down");
  assert.equal(await onServer(`SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r1'`), null, "the office's delete goes up");

  await sync(a());
  assert.equal(one(a().db, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r1'`), null);
});

test("both computers edit the same row: the last push wins everywhere", async () => {
  sql(a(), `UPDATE "Week" SET "order" = 30 WHERE "id" = 'w3'`);
  sql(b(), `UPDATE "Week" SET "order" = 31 WHERE "id" = 'w3'`);
  await sync(a());
  await sync(b());
  await sync(a());
  assert.deepEqual(await onServer(`SELECT "order" FROM "Week" WHERE "id" = 'w3'`), { order: 31 });
  assert.deepEqual(one(a().db, `SELECT "order" FROM "Week" WHERE "id" = 'w3'`), { order: 31 });
});

test("a row added under something the other computer deleted is dropped, and sync carries on", async () => {
  const db = new Database(a().db);
  db.pragma("foreign_keys = ON");
  db.prepare(`DELETE FROM "Week" WHERE "id" = 'w3'`).run();
  db.close();
  await sync(a());
  // The office hasn't heard yet, and adds a day to that week.
  const s = b().state as { lastPull: number };
  sql(b(), `INSERT INTO "Day" ("id", "weekId", "index", "label") VALUES ('d9', 'w3', 0, 'Tue')`);
  s.lastPull = Date.now();
  switchTo(b());
  await sync(b());
  assert.equal(await onServer(`SELECT 1 FROM "Day" WHERE "id" = 'd9'`), null);
  await sync(b());
  assert.equal(one(b().db, `SELECT 1 FROM "Week" WHERE "id" = 'w3'`), null);
});

test("a restored backup takes over: what isn't in it goes from the server", async () => {
  restart(a());
  sql(a(), `DELETE FROM "Program" WHERE "id" = 'p1'`);
  // What staging a restore leaves beside the database.
  fs.writeFileSync(path.join(path.dirname(a().db), "topset-sync-reset"), "");
  await sync(a());
  assert.equal(await onServer(`SELECT 1 FROM "Program" WHERE "id" = 'p1'`), null);
  assert.equal(fs.existsSync(path.join(path.dirname(a().db), "topset-sync-reset")), false);
});
