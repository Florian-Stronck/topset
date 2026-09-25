import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { migrateRemote } from "@/lib/cloud";
import { applyPush, athleteData } from "@/lib/sync-server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topset-sync-server-"));
let client: Client;

before(async () => {
  client = createClient({ url: `file:${path.join(dir, "server.db").replace(/\\/g, "/")}` });
  await migrateRemote(client, path.join("prisma", "migrations"));
  await client.executeMultiple(`
    INSERT INTO "Coach" ("id", "username", "name") VALUES ('me', 'me', 'Me');
    INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('a1', 'me', 'Ann');
    INSERT INTO "Program" ("id", "athleteId", "name") VALUES ('p1', 'a1', 'Plan');
    INSERT INTO "Block" ("id", "athleteId", "programId", "phase", "startDate") VALUES ('b1', 'a1', 'p1', 'Base', 0);
    INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w1', 'b1', 1);
    INSERT INTO "Day" ("id", "weekId", "index", "label") VALUES ('d1', 'w1', 0, 'Mon');
    INSERT INTO "ExerciseRow" ("id", "dayId", "order", "target", "exercise") VALUES ('r1', 'd1', 0, 'Squat', 'Squat');
  `);
});

after(() => {
  client.close();
  // Windows can hold the file a moment past close; a leftover temp folder is harmless.
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});

test("a pull with the current version reads nothing else", async () => {
  const full = await athleteData(client, "me");
  assert.equal(full.unchanged, undefined);
  assert.equal(full.version, 0);
  assert.deepEqual(await athleteData(client, "me", 0), { unchanged: true, version: 0 });
});

test("a coach's own athlete-column edit moves the version on", async () => {
  const problem = await applyPush(client, "me", {
    tables: {},
    athlete: [{ id: "r1", values: { actualWeight: 100, performedRpe: 8, athleteNotes: null } }],
  });
  assert.equal(problem, null);
  const pulled = await athleteData(client, "me", 0);
  assert.equal(pulled.version, 1);
  assert.ok(!pulled.unchanged);
  assert.equal(pulled.rows[0].actualWeight, 100);
});

test("the orphan sweep runs only on a push that removes something", async () => {
  await client.execute(`PRAGMA foreign_keys = OFF`);
  await client.execute(`INSERT INTO "SetLog" ("id", "rowId", "setIndex", "loggedAt") VALUES ('stray', 'gone', 0, 0)`);
  const strays = async () => (await client.execute(`SELECT count(*) AS n FROM "SetLog" WHERE "id" = 'stray'`)).rows[0].n;

  const edit = { id: "r1", dayId: "d1", order: 0, target: "Squat", exercise: "Front squat" };
  assert.equal(await applyPush(client, "me", { tables: { ExerciseRow: { upsert: [edit], remove: [] } }, athlete: [] }), null);
  assert.equal(Number(await strays()), 1);

  assert.equal(await applyPush(client, "me", { tables: { ExerciseRow: { upsert: [], remove: ["r1"] } }, athlete: [] }), null);
  assert.equal(Number(await strays()), 0);
});

test("weigh-ins from the coach: newer edits win, and a delete travels as a tombstone", async () => {
  const entry = {
    id: "bw1",
    athleteId: "a1",
    day: "2026-09-20",
    weight: 82.4,
    note: null,
    source: "coach",
    createdAt: "2026-09-20T07:00:00.000+00:00",
    updatedAt: "2026-09-20T07:00:00.000+00:00",
    deletedAt: null,
  };
  assert.equal(await applyPush(client, "me", { tables: {}, athlete: [], merged: { BodyweightLog: [entry] } }), null);
  const first = await athleteData(client, "me");
  assert.ok(!first.unchanged);
  assert.equal(first.merged.BodyweightLog.length, 1);
  assert.equal(first.merged.BodyweightLog[0].weight, 82.4);

  // An older copy of the same row changes nothing.
  const stale = { ...entry, weight: 90, updatedAt: "2026-09-19T07:00:00.000+00:00" };
  assert.equal(await applyPush(client, "me", { tables: {}, athlete: [], merged: { BodyweightLog: [stale] } }), null);
  const deleted = { ...entry, updatedAt: "2026-09-21T07:00:00.000+00:00", deletedAt: "2026-09-21T07:00:00.000+00:00" };
  assert.equal(await applyPush(client, "me", { tables: {}, athlete: [], merged: { BodyweightLog: [deleted] } }), null);
  const after = await athleteData(client, "me");
  assert.ok(!after.unchanged);
  assert.equal(after.merged.BodyweightLog[0].weight, 82.4);
  assert.ok(after.merged.BodyweightLog[0].deletedAt);
});

test("a weigh-in for someone else's athlete is refused", async () => {
  await client.execute(`INSERT INTO "Coach" ("id", "username", "name") VALUES ('them', 'them', 'Them')`);
  await client.execute(`INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('a9', 'them', 'Bo')`);
  const entry = { id: "bw9", athleteId: "a9", day: "2026-09-20", weight: 70, note: null, source: "coach", createdAt: 0, updatedAt: 1, deletedAt: null };
  assert.equal(await applyPush(client, "me", { tables: {}, athlete: [], merged: { BodyweightLog: [entry] } }), "That athlete isn't yours.");
});

test("check-in answers merge like weigh-ins, and only to the coach's own questions", async () => {
  await client.execute(
    `INSERT INTO "CheckinQuestion" ("id", "athleteId", "label", "kind") VALUES ('q1', 'a1', 'Sleep', 'SCALE'), ('q9', 'a9', 'Theirs', 'TEXT')`,
  );
  const entry = {
    id: "ca1", athleteId: "a1", questionId: "q1", day: "2026-09-21", value: "2",
    createdAt: "2026-09-21T06:00:00.000+00:00", updatedAt: "2026-09-21T06:00:00.000+00:00", deletedAt: null,
  };
  assert.equal(await applyPush(client, "me", { tables: {}, athlete: [], merged: { CheckinAnswer: [entry] } }), null);
  const pulled = await athleteData(client, "me");
  assert.ok(!pulled.unchanged);
  assert.equal(pulled.merged.CheckinAnswer[0].value, "2");
  assert.equal(
    await applyPush(client, "me", { tables: {}, athlete: [], merged: { CheckinAnswer: [{ ...entry, id: "ca2", value: 3 }] } }),
    "A CheckinAnswer row is missing something.",
  );
  assert.equal(
    await applyPush(client, "me", { tables: {}, athlete: [], merged: { CheckinAnswer: [{ ...entry, id: "ca3", questionId: "q9" }] } }),
    "That question isn't yours.",
  );
  assert.equal(
    await applyPush(client, "me", { tables: {}, athlete: [], merged: { SetLog: [entry] } }),
    "SetLog can't be synced.",
  );
});

test("coach messages merge both ways: the coach's text up, the athlete's read receipt down", async () => {
  const note = {
    id: "m1", athleteId: "a1", day: "2026-09-21", dayId: "d1", rowId: null, body: "Great speed off the floor.", readAt: null,
    createdAt: "2026-09-21T18:00:00.000+00:00", updatedAt: "2026-09-21T18:00:00.000+00:00", deletedAt: null,
  };
  assert.equal(await applyPush(client, "me", { tables: {}, athlete: [], merged: { CoachMessage: [note] } }), null);

  // The athlete app reads it on the server; the desktop copy takes the newer row.
  await client.execute(`UPDATE "CoachMessage" SET "readAt" = '2026-09-22T07:00:00.000+00:00', "updatedAt" = '2026-09-22T07:00:00.000+00:00' WHERE "id" = 'm1'`);
  const pulled = await athleteData(client, "me");
  assert.ok(!pulled.unchanged);
  assert.equal(pulled.merged.CoachMessage[0].readAt, "2026-09-22T07:00:00.000+00:00");

  // An older copy from the desktop doesn't undo the read.
  assert.equal(await applyPush(client, "me", { tables: {}, athlete: [], merged: { CoachMessage: [note] } }), null);
  const again = await athleteData(client, "me");
  assert.ok(!again.unchanged);
  assert.equal(again.merged.CoachMessage[0].readAt, "2026-09-22T07:00:00.000+00:00");

  assert.equal(
    await applyPush(client, "me", { tables: {}, athlete: [], merged: { CoachMessage: [{ ...note, id: "m2", body: 3 }] } }),
    "A CoachMessage row is missing something.",
  );
  assert.equal(
    await applyPush(client, "me", { tables: {}, athlete: [], merged: { CoachMessage: [{ ...note, id: "m3", athleteId: "a9" }] } }),
    "That athlete isn't yours.",
  );
});
