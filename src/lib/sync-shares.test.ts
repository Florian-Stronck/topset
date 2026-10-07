import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { createClient, type Client } from "@libsql/client";
import { migrateRemote } from "@/lib/cloud";
import { knowsShares } from "@/lib/desktop-version";
import { syncNow } from "@/lib/sync";
import { accessData, applyPush, athleteData, planData, planRev, snapshot } from "@/lib/sync-server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { migrate } = require("../../electron/migrate.js") as { migrate: (db: Database.Database, dir: string) => void };

/**
 * Coaches sharing athletes, one server — all in this process, like the two-computer test.
 * Anna owns the athletes; Ben gets one to edit, Cleo one to view and one to review. Ben
 * also has a computer on an app from before shares, which must keep working as it did.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topset-shares-"));
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
  await server.execute(`INSERT INTO "Coach" ("id", "username", "name") VALUES ('anna', 'anna', 'Anna'), ('ben', 'ben', 'Ben'), ('cleo', 'cleo', 'Cleo')`);

  // What the sync route does, without the network.
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const session = String(headers.Authorization ?? "").replace("Bearer ", "");
    const coach = computers.find((c) => c.token === session)!.coach;
    const shared = knowsShares(new Request(url, { headers }));
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

let anna: Computer, ben: Computer, benOld: Computer, cleo: Computer;

const share = (athlete: string, coach: string, role: string) =>
  server.execute({
    sql: `INSERT INTO "AthleteShare" ("athleteId", "coachId", "role") VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET "role" = excluded."role"`,
    args: [athlete, coach, role],
  });
const unshare = (athlete: string, coach: string) =>
  server.execute({ sql: `DELETE FROM "AthleteShare" WHERE "athleteId" = ? AND "coachId" = ?`, args: [athlete, coach] });

/** A plan of one row on one day, under a new athlete of Anna's. */
function plan(c: Computer, athlete: string, name: string) {
  const id = (x: string) => `${x}-${athlete}`;
  sql(c, `INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('${athlete}', 'anna', '${name}')`);
  sql(c, `INSERT INTO "Program" ("id", "athleteId", "name") VALUES ('${id("p")}', '${athlete}', 'Plan')`);
  sql(c, `INSERT INTO "Block" ("id", "athleteId", "programId", "phase", "startDate") VALUES ('${id("b")}', '${athlete}', '${id("p")}', 'Base', 0)`);
  sql(c, `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('${id("w")}', '${id("b")}', 1)`);
  sql(c, `INSERT INTO "Day" ("id", "weekId", "index", "label") VALUES ('${id("d")}', '${id("w")}', 0, 'Mon')`);
  sql(c, `INSERT INTO "ExerciseRow" ("id", "dayId", "order", "target", "exercise") VALUES ('${id("r")}', '${id("d")}', 0, 'Squat', 'Squat')`);
}

test("a shared athlete reaches the coach with their role; private ones and older apps stay as they were", async () => {
  anna = computer("anna-pc", "anna", "0.9.0");
  ben = computer("ben-pc", "ben", "0.9.0");
  benOld = computer("ben-old", "ben", "0.8.0");
  cleo = computer("cleo-pc", "cleo", "0.9.0");

  sql(anna, `INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('mine', 'anna', 'Private')`);
  plan(anna, "ed", "Edited");
  plan(anna, "vi", "Viewed");
  plan(anna, "re", "Reviewed");
  sql(ben, `INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('bens', 'ben', 'Bens')`);
  await sync(anna);
  await sync(ben);
  // Shared on the server, as entering a code does.
  await share("ed", "ben", "edit");
  await share("vi", "cleo", "view");
  await share("re", "cleo", "review");

  for (const c of [anna, ben, benOld, cleo]) await sync(c);
  assert.ok(one(ben, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r-ed'`), "Ben has the shared plan");
  assert.deepEqual(one(ben, `SELECT "name" FROM "Coach" WHERE "id" = 'anna'`), { name: "Anna" }, "and knows whose it is");
  assert.deepEqual(one(ben, `SELECT "role" FROM "AthleteShare" WHERE "athleteId" = 'ed' AND "coachId" = 'ben'`), { role: "edit" });
  assert.equal(one(ben, `SELECT 1 FROM "Athlete" WHERE "id" = 'mine'`), null, "but not Anna's private athlete");
  assert.equal(one(ben, `SELECT 1 FROM "Athlete" WHERE "id" = 'vi'`), null, "nor one shared with someone else");
  assert.deepEqual(one(cleo, `SELECT "role" FROM "AthleteShare" WHERE "athleteId" = 'vi' AND "coachId" = 'cleo'`), { role: "view" });
  assert.ok(one(cleo, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r-re'`));
  assert.ok(one(anna, `SELECT 1 FROM "AthleteShare" WHERE "athleteId" = 'vi' AND "coachId" = 'cleo'`), "Anna sees who she shared with");
  assert.ok(one(anna, `SELECT 1 FROM "Coach" WHERE "id" = 'cleo'`));
  assert.equal(one(benOld, `SELECT 1 FROM "Athlete" WHERE "id" = 'ed'`), null, "an older app only gets Ben's own");
  assert.ok(one(benOld, `SELECT 1 FROM "Athlete" WHERE "id" = 'bens'`));
});

test("an edit share's change reaches the owner, and back", async () => {
  sql(ben, `UPDATE "ExerciseRow" SET "exercise" = 'Front squat' WHERE "id" = 'r-ed'`);
  await sync(ben);
  await sync(anna);
  assert.deepEqual(one(anna, `SELECT "exercise" FROM "ExerciseRow" WHERE "id" = 'r-ed'`), { exercise: "Front squat" });

  sql(anna, `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w2-ed', 'b-ed', 2)`);
  await sync(anna);
  await sync(ben);
  assert.ok(one(ben, `SELECT 1 FROM "Week" WHERE "id" = 'w2-ed'`));
  sql(ben, `UPDATE "Athlete" SET "name" = 'Edited, renamed by Ben' WHERE "id" = 'ed'`);
  await sync(ben);
  assert.deepEqual(await onServer(`SELECT "name", "coachId" FROM "Athlete" WHERE "id" = 'ed'`), { name: "Edited, renamed by Ben", coachId: "anna" });
});

test("a view share changes nothing: the change bounces back, and sync carries on", async () => {
  sql(cleo, `UPDATE "ExerciseRow" SET "exercise" = 'Box squat' WHERE "id" = 'r-vi'`);
  sql(cleo, `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w2-vi', 'b-vi', 2)`);
  await sync(cleo);
  assert.deepEqual(await onServer(`SELECT "exercise" FROM "ExerciseRow" WHERE "id" = 'r-vi'`), { exercise: "Squat" });
  assert.equal(await onServer(`SELECT 1 FROM "Week" WHERE "id" = 'w2-vi'`), null);
  await sync(cleo);
  assert.deepEqual(one(cleo, `SELECT "exercise" FROM "ExerciseRow" WHERE "id" = 'r-vi'`), { exercise: "Squat" }, "Cleo's copy is the server's again");
  assert.equal(one(cleo, `SELECT 1 FROM "Week" WHERE "id" = 'w2-vi'`), null);

  // Pushed straight at the server, it's dropped there too.
  assert.equal(
    await applyPush(server, "cleo", { tables: { ExerciseRow: { upsert: [{ id: "r-vi", dayId: "d-vi", order: 0, target: "Squat", exercise: "Pin squat" }], remove: [] } }, athlete: [] }),
    null,
  );
  assert.deepEqual(await onServer(`SELECT "exercise" FROM "ExerciseRow" WHERE "id" = 'r-vi'`), { exercise: "Squat" });
  assert.equal(await applyPush(server, "cleo", { tables: { ExerciseRow: { upsert: [], remove: ["r-vi"] } }, athlete: [] }), null);
  assert.ok(await onServer(`SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r-vi'`));
  const note = { id: "n-vi", athleteId: "vi", sender: "coach", day: "2026-10-06", body: "Hi", createdAt: Date.now(), updatedAt: Date.now() };
  assert.equal(await applyPush(server, "cleo", { tables: {}, athlete: [], merged: { CoachMessage: [note] } }), null);
  assert.equal(await onServer(`SELECT 1 FROM "CoachMessage" WHERE "id" = 'n-vi'`), null, "a viewer doesn't write to the athlete");
});

test("a review share marks sessions reviewed and writes notes, and changes nothing else", async () => {
  const now = Date.now();
  sql(cleo, `UPDATE "Day" SET "reviewedAt" = ${now} WHERE "id" = 'd-re'`);
  sql(cleo, `INSERT INTO "CoachMessage" ("id", "athleteId", "sender", "day", "body", "createdAt", "updatedAt") VALUES ('n-re', 're', 'coach', '2026-10-06', 'Good work', ${now}, ${now})`);
  await sync(cleo);
  assert.ok((await onServer(`SELECT "reviewedAt" FROM "Day" WHERE "id" = 'd-re'`))?.reviewedAt, "the mark is in");
  assert.deepEqual(await onServer(`SELECT "body" FROM "CoachMessage" WHERE "id" = 'n-re'`), { body: "Good work" });
  await sync(anna);
  assert.ok((one(anna, `SELECT "reviewedAt" FROM "Day" WHERE "id" = 'd-re'`) as { reviewedAt: unknown }).reviewedAt, "and reaches the owner");

  // A label change rides along with a mark: only the mark goes in.
  assert.equal(
    await applyPush(server, "cleo", { tables: { Day: { upsert: [{ id: "d-re", weekId: "w-re", index: 0, label: "Changed", rest: 0, reviewedAt: null }], remove: [] } }, athlete: [] }),
    null,
  );
  assert.deepEqual(await onServer(`SELECT "label", "reviewedAt" FROM "Day" WHERE "id" = 'd-re'`), { label: "Mon", reviewedAt: null });
  sql(cleo, `UPDATE "ExerciseRow" SET "exercise" = 'Box squat' WHERE "id" = 'r-re'`);
  await sync(cleo);
  assert.deepEqual(await onServer(`SELECT "exercise" FROM "ExerciseRow" WHERE "id" = 'r-re'`), { exercise: "Squat" });
});

test("only the owner deletes an athlete or hands it over", async () => {
  assert.match(String(await applyPush(server, "ben", { tables: { Athlete: { upsert: [], remove: ["ed"] } }, athlete: [] })), /Only the coach who added/);
  assert.match(
    String(await applyPush(server, "ben", { tables: { Athlete: { upsert: [{ id: "ed", coachId: "ben", name: "Mine now" }], remove: [] } }, athlete: [] })),
    /isn't yours/,
  );
  assert.match(String(await applyPush(server, "ben", { tables: { Athlete: { upsert: [{ id: "mine", coachId: "anna", name: "x" }], remove: [] } }, athlete: [] })), /someone else/);
});

test("a take-over on a shared coach's computer leaves the owner's work alone", async () => {
  sql(anna, `INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w3-ed', 'b-ed', 3)`);
  await sync(anna);
  // Ben's computer hasn't heard about w3 yet when he restores a backup (or hits Sync now).
  (ben.state as { local: Database.Database | null }).local?.close();
  ben.state = undefined;
  fs.writeFileSync(path.join(path.dirname(ben.db), "topset-sync-reset"), "");
  await sync(ben);
  assert.equal(fs.existsSync(path.join(path.dirname(ben.db), "topset-sync-reset")), false, "the take-over went through");
  assert.ok(await onServer(`SELECT 1 FROM "Week" WHERE "id" = 'w3-ed'`));
  assert.ok(await onServer(`SELECT 1 FROM "Athlete" WHERE "id" = 'ed'`));
});

test("a restored backup with an athlete no longer shared still takes over", async () => {
  const backup = path.join(path.dirname(ben.db), "backup.db");
  await sync(ben);
  (ben.state as { local: Database.Database | null }).local?.close();
  ben.state = undefined;
  fs.copyFileSync(ben.db, backup);
  await unshare("ed", "ben");
  fs.copyFileSync(backup, ben.db);
  fs.writeFileSync(path.join(path.dirname(ben.db), "topset-sync-reset"), "");
  await sync(ben);
  assert.equal(one(ben, `SELECT 1 FROM "Athlete" WHERE "id" = 'ed'`), null);
  assert.ok(await onServer(`SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r-ed'`), "Anna's plan is untouched");
  await share("ed", "ben", "edit");
  await sync(ben);
  assert.ok(one(ben, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r-ed'`), "and shared again, it comes back");
});

test("an athlete no longer shared leaves the coach's computer, and sync carries on", async () => {
  await unshare("ed", "ben");
  await sync(ben);
  assert.equal(one(ben, `SELECT 1 FROM "Athlete" WHERE "id" = 'ed'`), null);
  assert.equal(one(ben, `SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r-ed'`), null);
  sql(ben, `UPDATE "Athlete" SET "name" = 'Bens renamed' WHERE "id" = 'bens'`);
  await sync(ben);
  assert.deepEqual(await onServer(`SELECT "name" FROM "Athlete" WHERE "id" = 'bens'`), { name: "Bens renamed" });
  assert.ok(await onServer(`SELECT 1 FROM "ExerciseRow" WHERE "id" = 'r-ed'`), "Anna's plan is untouched");
});

test("deleting an athlete takes its shares with it", async () => {
  sql(anna, `DELETE FROM "Athlete" WHERE "id" = 'vi'`);
  await sync(anna);
  assert.equal(await onServer(`SELECT 1 FROM "AthleteShare" WHERE "athleteId" = 'vi'`), null);
  await sync(cleo);
  assert.equal(one(cleo, `SELECT 1 FROM "Athlete" WHERE "id" = 'vi'`), null);
});
