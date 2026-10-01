import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { createClient, type Client } from "@libsql/client";
import { migrateRemote } from "@/lib/cloud";
import { knowsTeams } from "@/lib/desktop-version";
import { syncNow } from "@/lib/sync";
import { accessData, applyPush, athleteData, planData, planRev, snapshot } from "@/lib/sync-server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { migrate } = require("../../electron/migrate.js") as { migrate: (db: Database.Database, dir: string) => void };

/**
 * Two coaches on one team, one server — all in this process, like the two-computer test.
 * Anna and Ben each have a computer on the current app; Ben also has one on an app from
 * before teams, which must keep working as it did.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topset-teams-"));
let server: Client;

type Computer = { token: string; coach: string; db: string; config: string; version?: string; state?: unknown };
const g = globalThis as unknown as { __topsetSync?: unknown };
const computers: Computer[] = [];

function computer(token: string, coach: string, version?: string): Computer {
  const home = path.join(dir, token);
  fs.mkdirSync(home);
  const c: Computer = { token, coach, version, db: path.join(home, "topset.db"), config: path.join(home, "topset-cloud.json") };
  const db = new Database(c.db);
  db.pragma("journal_mode = WAL");
  migrate(db, path.join("prisma", "migrations"));
  db.prepare(`INSERT INTO "Coach" ("id", "username", "name") VALUES (?, ?, ?)`).run(coach, coach, coach[0].toUpperCase() + coach.slice(1));
  db.close();
  fs.writeFileSync(c.config, JSON.stringify({ server: "http://topset.test", token, coachId: coach, username: coach, name: coach, isAdmin: false, seeded: true }));
  computers.push(c);
  return c;
}

async function sync(c: Computer) {
  process.env.DATABASE_URL = `file:${c.db}`;
  process.env.TOPSET_CLOUD_FILE = c.config;
  if (c.version) process.env.TOPSET_APP_VERSION = c.version;
  else delete process.env.TOPSET_APP_VERSION;
  g.__topsetSync = c.state;
  const { error } = await syncNow();
  c.state = g.__topsetSync;
  assert.equal(error, null, `${c.token}: ${error}`);
}

function sql(c: Computer, statement: string) {
  const db = new Database(c.db);
  try {
    db.prepare(statement).run();
  } finally {
    db.close();
  }
}

function one(c: Computer, statement: string): unknown {
  const db = new Database(c.db, { readonly: true });
  try {
    return (db.prepare(statement).get() as Record<string, unknown> | undefined) ?? null;
  } finally {
    db.close();
  }
}

const onServer = async (statement: string) => (await server.execute(statement)).rows[0] ?? null;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

before(async () => {
  server = createClient({ url: `file:${path.join(dir, "server.db").replace(/\\/g, "/")}` });
  await migrateRemote(server, path.join("prisma", "migrations"));
  await server.execute(`INSERT INTO "Coach" ("id", "username", "name") VALUES ('anna', 'anna', 'Anna'), ('ben', 'ben', 'Ben')`);
  await server.execute(`INSERT INTO "Team" ("id", "name") VALUES ('gym', 'The Gym')`);
  await server.execute(`INSERT INTO "TeamMember" ("teamId", "coachId") VALUES ('gym', 'anna'), ('gym', 'ben')`);

  // What the sync route does, without the network.
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const session = String(headers.Authorization ?? "").replace("Bearer ", "");
    const coach = computers.find((c) => c.token === session)!.coach;
    const shared = knowsTeams(new Request(url, { headers }));
    if (url.pathname === "/api/coach/videos") return reply({ ok: true, urls: {} });
    if (init?.method === "POST") {
      const problem = await applyPush(server, coach, JSON.parse(String(init.body)), undefined, session);
      return problem ? reply({ ok: false, error: problem }, 422) : reply({ ok: true });
    }
    const part = url.searchParams.get("part");
    const since = url.searchParams.get("since");
    if (part === "athlete") return reply({ ok: true, ...(await athleteData(server, coach, since === null ? undefined : Number(since), shared)) });
    if (part === "plan") return reply({ ok: true, ...(await planData(server, coach, session, Number(since), undefined, shared)) });
    if ((part === "access" || part === "athletes") && !shared) return reply({ ok: false, error: "Unknown part." }, 400);
    if (part === "access") return reply({ ok: true, ...(await accessData(server, coach)) });
    if (part === "athletes") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      return reply({ ok: true, rev: await planRev(server), tables: await snapshot(server, coach, false, true, ids) });
    }
    return reply({ ok: true, rev: await planRev(server), tables: await snapshot(server, coach, part === "ids", part === "snapshot" && shared) });
  }) as typeof fetch;
});

after(() => {
  for (const c of computers) (c.state as { local: Database.Database | null } | undefined)?.local?.close();
  server.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});

let anna: Computer, annaOld: Computer, ben: Computer, benOld: Computer;

test("a shared athlete reaches the teammate; private ones and older apps stay as they were", async () => {
  anna = computer("anna-pc", "anna", "0.6.0");
  annaOld = computer("anna-old", "anna", "0.5.0");
  ben = computer("ben-pc", "ben", "0.6.0");
  benOld = computer("ben-old", "ben", "0.5.0");

  sql(anna, `INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('mine', 'anna', 'Private'), ('ours', 'anna', 'Shared')`);
  sql(anna, `INSERT INTO "Program" ("id", "athleteId", "name") VALUES ('p1', 'ours', 'Plan')`);
  sql(anna, `INSERT INTO "Block" ("id", "athleteId", "programId", "phase", "startDate") VALUES ('b1', 'ours', 'p1', 'Base', 0)`);
  sql(anna, `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w1', 'b1', 1)`);
  sql(anna, `INSERT INTO "Day" ("id", "weekId", "index", "label") VALUES ('d1', 'w1', 0, 'Mon')`);
  sql(anna, `INSERT INTO "ExerciseRow" ("id", "dayId", "order", "target", "exercise") VALUES ('r1', 'd1', 0, 'Squat', 'Squat')`);
  sql(ben, `INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('bens', 'ben', 'Bens')`);
  await sync(anna);
  await sync(ben);
  // Anna shares one athlete with the team (on the server, as the athlete card does).
  await server.execute(`UPDATE "Athlete" SET "teamId" = 'gym' WHERE "id" = 'ours'`);

  await sync(anna);
  await sync(ben);
  await sync(annaOld);
  await sync(benOld);
  assert.ok(one(ben, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r1'`), "Ben has the shared plan");
  assert.deepEqual(one(ben, `SELECT "name" FROM "Coach" WHERE "id" = 'anna'`), { name: "Anna" }, "and knows whose it is");
  assert.deepEqual(one(ben, `SELECT "teamId" FROM "Athlete" WHERE "id" = 'ours'`), { teamId: "gym" });
  assert.equal(one(ben, `SELECT 1 FROM "Athlete" WHERE "id" = 'mine'`), null, "but not Anna's private athlete");
  assert.equal(one(benOld, `SELECT 1 FROM "Athlete" WHERE "id" = 'ours'`), null, "an older app only gets Ben's own");
  assert.ok(one(benOld, `SELECT 1 FROM "Athlete" WHERE "id" = 'bens'`));
});

test("a teammate's edit reaches the owner, on old apps too, and back", async () => {
  sql(ben, `UPDATE "ExerciseRow" SET "exercise" = 'Front squat' WHERE "id" = 'r1'`);
  await sync(ben);
  await sync(anna);
  await sync(annaOld);
  assert.deepEqual(one(anna, `SELECT "exercise" FROM "ExerciseRow" WHERE "id" = 'r1'`), { exercise: "Front squat" });
  assert.deepEqual(one(annaOld, `SELECT "exercise" FROM "ExerciseRow" WHERE "id" = 'r1'`), { exercise: "Front squat" });

  sql(anna, `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w2', 'b1', 2)`);
  await sync(anna);
  await sync(ben);
  assert.ok(one(ben, `SELECT 1 FROM "Week" WHERE "id" = 'w2'`));
  // Nobody's coach row went anywhere it shouldn't.
  assert.deepEqual(await onServer(`SELECT "name" FROM "Coach" WHERE "id" = 'anna'`), { name: "Anna" });
  await sync(benOld);
});

test("only the owner deletes an athlete or hands it over", async () => {
  assert.match(String(await applyPush(server, "ben", { tables: { Athlete: { upsert: [], remove: ["ours"] } }, athlete: [] })), /Only the coach who added/);
  assert.match(
    String(await applyPush(server, "ben", { tables: { Athlete: { upsert: [{ id: "ours", coachId: "ben", name: "Mine now" }], remove: [] } }, athlete: [] })),
    /isn't yours/,
  );
  assert.match(String(await applyPush(server, "ben", { tables: { Athlete: { upsert: [{ id: "mine", coachId: "anna", name: "x" }], remove: [] } }, athlete: [] })), /someone else/);
  // A push can't move an athlete onto a team.
  assert.equal(await applyPush(server, "anna", { tables: { Athlete: { upsert: [{ id: "mine", coachId: "anna", name: "Private", teamId: "gym" }], remove: [] } }, athlete: [] }), null);
  assert.deepEqual(await onServer(`SELECT "teamId" FROM "Athlete" WHERE "id" = 'mine'`), { teamId: null });
});

test("a teammate edits a shared athlete's own details", async () => {
  sql(ben, `UPDATE "Athlete" SET "name" = 'Shared, renamed by Ben' WHERE "id" = 'ours'`);
  await sync(ben);
  assert.deepEqual(await onServer(`SELECT "name", "coachId" FROM "Athlete" WHERE "id" = 'ours'`), { name: "Shared, renamed by Ben", coachId: "anna" });
});

test("a take-over on a teammate's computer leaves the rest of the team's work alone", async () => {
  sql(anna, `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w3', 'b1', 3)`);
  await sync(anna);
  // Ben's computer hasn't heard about w3 yet when he restores a backup (or hits Sync now).
  (ben.state as { local: Database.Database | null }).local?.close();
  ben.state = undefined;
  fs.writeFileSync(path.join(path.dirname(ben.db), "topset-sync-reset"), "");
  await sync(ben);
  assert.equal(fs.existsSync(path.join(path.dirname(ben.db), "topset-sync-reset")), false, "the take-over went through");
  assert.ok(await onServer(`SELECT 1 FROM "Week" WHERE "id" = 'w3'`));
  assert.ok(await onServer(`SELECT 1 FROM "Athlete" WHERE "id" = 'ours'`));
});

test("a restored backup with a teammate's athlete no longer shared still takes over", async () => {
  const backup = path.join(path.dirname(ben.db), "backup.db");
  await sync(ben);
  (ben.state as { local: Database.Database | null }).local?.close();
  ben.state = undefined;
  fs.copyFileSync(ben.db, backup);
  await server.execute(`UPDATE "Athlete" SET "teamId" = NULL WHERE "id" = 'ours'`);
  fs.copyFileSync(backup, ben.db);
  fs.writeFileSync(path.join(path.dirname(ben.db), "topset-sync-reset"), "");
  await sync(ben);
  assert.equal(one(ben, `SELECT 1 FROM "Athlete" WHERE "id" = 'ours'`), null);
  assert.ok(await onServer(`SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r1'`), "Anna's plan is untouched");
  await server.execute(`UPDATE "Athlete" SET "teamId" = 'gym' WHERE "id" = 'ours'`);
  await sync(ben);
  assert.ok(one(ben, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r1'`), "and shared again, it comes back");
});

test("an athlete no longer shared leaves the teammate's computer, and sync carries on", async () => {
  await server.execute(`UPDATE "Athlete" SET "teamId" = NULL WHERE "id" = 'ours'`);
  await sync(ben);
  assert.equal(one(ben, `SELECT 1 FROM "Athlete" WHERE "id" = 'ours'`), null);
  assert.equal(one(ben, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r1'`), null);
  sql(ben, `UPDATE "Athlete" SET "name" = 'Bens renamed' WHERE "id" = 'bens'`);
  await sync(ben);
  assert.deepEqual(await onServer(`SELECT "name" FROM "Athlete" WHERE "id" = 'bens'`), { name: "Bens renamed" });
  assert.ok(await onServer(`SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r1'`), "Anna's plan is untouched");
});
