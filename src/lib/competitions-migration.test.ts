import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { migrateRemote } from "@/lib/cloud";
import { applyPlan } from "@/lib/sync";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { migrate } = require("../../electron/migrate.js") as { migrate: (db: Database.Database, dir: string) => void };

const MIGRATION = "20261111090000_competitions";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topset-competitions-migration-"));

// Windows can still hold the SQLite file after close; a leftover temp dir is harmless.
after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("every meet becomes its own competition, under the same id, with its attempts and tasks kept", async () => {
  const before = path.join(dir, "before");
  for (const name of fs.readdirSync(path.join("prisma", "migrations"))) {
    if (name >= MIGRATION || !name.match(/^\d/)) continue;
    fs.cpSync(path.join("prisma", "migrations", name), path.join(before, name), { recursive: true });
  }

  const client = createClient({ url: `file:${path.join(dir, "db.sqlite").replace(/\\/g, "/")}` });
  await migrateRemote(client, before);
  await client.executeMultiple(`
    INSERT INTO "Coach" ("id", "username", "name") VALUES ('anna', 'anna', 'Anna');
    INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('a1', 'anna', 'Ath');
    INSERT INTO "Meet" ("id", "athleteId", "name", "federation", "date", "venue", "rackBrand", "shared", "goal", "session")
      VALUES ('m1', 'a1', 'Nationals', 'IPF', 0, 'Hall', 'Eleiko', false, 600, 'Session 1');
    INSERT INTO "Attempt" ("id", "meetId", "lift", "number") VALUES ('at1', 'm1', 'SQUAT', 1);
    INSERT INTO "MeetTask" ("id", "athleteId", "meetId", "text", "day", "owner", "updatedAt") VALUES ('t1', 'a1', 'm1', 'Book hotel', '2026-12-01', 'COACH', 0);
  `);
  await migrateRemote(client, path.join("prisma", "migrations"));

  const [comp] = (await client.execute(`SELECT * FROM "Competition"`)).rows;
  assert.deepEqual(
    [comp.id, comp.coachId, comp.name, comp.federation, comp.venue, comp.rackBrand, Number(comp.shared)],
    ["m1", "anna", "Nationals", "IPF", "Hall", "Eleiko", 0],
  );
  const [meet] = (await client.execute(`SELECT * FROM "Meet"`)).rows;
  assert.deepEqual([meet.competitionId, meet.goal, meet.session], ["m1", 600, "Session 1"]);
  assert.equal((await client.execute(`SELECT count(*) AS n FROM "Attempt" WHERE "meetId" = 'm1'`)).rows[0].n, 1, "attempts stay");
  assert.equal((await client.execute(`SELECT count(*) AS n FROM "MeetTask"`)).rows[0].n, 1, "tasks stay");
  client.close();
});

test("a shared athlete's new meet comes down without the owner's competition, which stays theirs", () => {
  const db = new Database(path.join(dir, "desk.db"));
  migrate(db, path.join("prisma", "migrations"));
  db.pragma("foreign_keys = ON");
  db.exec(`
    INSERT INTO "Coach" ("id", "username", "name") VALUES ('me', 'me', 'Me'), ('owner', 'shared:owner', 'Owner');
    INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('theirs', 'owner', 'Theirs'), ('mine', 'me', 'Mine');
  `);
  const meet = (id: string, athleteId: string) => ({ id, athleteId, name: "Nationals", date: 0, competitionId: `c-${id}`, shared: 1, shareAttempts: 0, createdAt: 0 });
  applyPlan(db, { rows: { Meet: [meet("m1", "theirs"), meet("m2", "mine")] }, removed: {} }, new Map(), "me");

  // One of the coach's own, under a competition deleted here and not yet sent, stays out.
  assert.deepEqual(db.prepare(`SELECT "id", "competitionId" FROM "Meet"`).all(), [{ id: "m1", competitionId: "c-m1" }]);
  assert.deepEqual(db.prepare(`SELECT "id", "coachId" FROM "Competition"`).all(), [{ id: "c-m1", coachId: "owner" }]);
  db.close();
});
