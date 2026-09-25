import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createClient } from "@libsql/client";
import { migrateRemote } from "@/lib/cloud";
import { normalizeUsername, validUsername } from "@/lib/auth";

const MIGRATION = "20260926090000_coach_username";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topset-username-"));

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("emails become the part before the @, and clashes keep apart", async () => {
  // Every migration before the rename, then coaches with emails, then the rename.
  const before = path.join(dir, "before");
  for (const name of fs.readdirSync(path.join("prisma", "migrations"))) {
    if (name >= MIGRATION || !name.match(/^\d/)) continue;
    fs.cpSync(path.join("prisma", "migrations", name), path.join(before, name), { recursive: true });
  }

  const client = createClient({ url: `file:${path.join(dir, "db.sqlite").replace(/\\/g, "/")}` });
  await migrateRemote(client, before);
  await client.executeMultiple(`
    INSERT INTO "Coach" ("id", "email", "name") VALUES ('c-anna1', 'Anna@gym.lu', 'Anna');
    INSERT INTO "Coach" ("id", "email", "name") VALUES ('c-anna2', 'anna@other.com', 'Anna B');
    INSERT INTO "Coach" ("id", "email", "name") VALUES ('c-ben', 'ben@gym.lu', 'Ben');
    INSERT INTO "Coach" ("id", "email", "name") VALUES ('c-local', 'coach@example.com', 'Coach');
  `);
  await migrateRemote(client, path.join("prisma", "migrations"));

  const rows = (await client.execute(`SELECT "id", "username" FROM "Coach" ORDER BY "id"`)).rows;
  assert.deepEqual(
    rows.map((r) => [r.id, r.username]),
    [
      ["c-anna1", "anna-nna1"],
      ["c-anna2", "anna-nna2"],
      ["c-ben", "ben"],
      ["c-local", "coach"],
    ],
  );
  await assert.rejects(client.execute(`INSERT INTO "Coach" ("id", "username", "name") VALUES ('x', 'ben', 'X')`));
  client.close();
});

test("a username is typed any case, and an old email still finds it", () => {
  assert.equal(normalizeUsername("  Anna "), "anna");
  assert.equal(normalizeUsername("Ben@gym.lu"), "ben");
  assert.ok(validUsername("coach.flo_1"));
  assert.ok(!validUsername("a"));
  assert.ok(!validUsername("with space"));
});
