import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createClient } from "@libsql/client";
import { migrateRemote } from "@/lib/cloud";

const MIGRATION = "20261022090000_athlete_shares";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topset-shares-migration-"));

// Windows can still hold the SQLite file after close; a leftover temp dir is harmless.
after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("teammates keep editing their team's athletes, as edit shares", async () => {
  // Every migration before shares, then a team, then the change.
  const before = path.join(dir, "before");
  for (const name of fs.readdirSync(path.join("prisma", "migrations"))) {
    if (name >= MIGRATION || !name.match(/^\d/)) continue;
    fs.cpSync(path.join("prisma", "migrations", name), path.join(before, name), { recursive: true });
  }

  const client = createClient({ url: `file:${path.join(dir, "db.sqlite").replace(/\\/g, "/")}` });
  await migrateRemote(client, before);
  await client.executeMultiple(`
    INSERT INTO "Coach" ("id", "username", "name") VALUES ('anna', 'anna', 'Anna'), ('ben', 'ben', 'Ben'), ('cleo', 'cleo', 'Cleo');
    INSERT INTO "Team" ("id", "name") VALUES ('gym', 'Gym');
    INSERT INTO "TeamMember" ("teamId", "coachId") VALUES ('gym', 'anna'), ('gym', 'ben');
    INSERT INTO "Athlete" ("id", "coachId", "name", "teamId") VALUES ('shared', 'anna', 'Shared', 'gym'), ('private', 'anna', 'Private', NULL);
    INSERT INTO "Program" ("id", "athleteId", "name") VALUES ('p1', 'shared', 'Plan');
  `);
  await migrateRemote(client, path.join("prisma", "migrations"));

  const shares = (await client.execute(`SELECT "athleteId", "coachId", "role" FROM "AthleteShare" ORDER BY "athleteId", "coachId"`)).rows;
  assert.deepEqual(shares.map((r) => [r.athleteId, r.coachId, r.role]), [["shared", "ben", "edit"]]);
  assert.equal((await client.execute(`SELECT count(*) AS n FROM "Athlete"`)).rows[0].n, 2);
  assert.ok((await client.execute(`SELECT 1 FROM "Program" WHERE "athleteId" = 'shared'`)).rows[0], "nothing under the athletes went");
  const teams = await client.execute(`SELECT name FROM sqlite_master WHERE name IN ('Team', 'TeamMember')`);
  assert.equal(teams.rows.length, 0);
  client.close();
});
