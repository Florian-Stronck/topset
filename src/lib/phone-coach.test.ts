import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { migrateRemote } from "@/lib/cloud";

/**
 * What the coach's phone writes on the server reaches the desktop apps: a review mark through
 * the plan log (to every computer but the phone itself), a note or weigh-in through the
 * athlete counter — for the owner and for the coach the athlete is shared with.
 */
test("phone writes reach the coaches' desktop apps", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topset-phone-"));
  const url = `file:${path.join(dir, "server.db")}`;
  const client = createClient({ url });
  await migrateRemote(client, path.join("prisma", "migrations"));
  await client.executeMultiple(`
    INSERT INTO "Coach" ("id", "username", "name") VALUES ('anna', 'anna', 'Anna'), ('ben', 'ben', 'Ben'), ('cleo', 'cleo', 'Cleo');
    INSERT INTO "Athlete" ("id", "coachId", "name") VALUES ('a1', 'anna', 'Ath');
    INSERT INTO "AthleteShare" ("athleteId", "coachId", "role") VALUES ('a1', 'ben', 'review');
    INSERT INTO "Program" ("id", "athleteId", "name") VALUES ('p1', 'a1', 'Plan');
    INSERT INTO "Block" ("id", "athleteId", "programId", "phase", "startDate") VALUES ('b1', 'a1', 'p1', 'Base', 0);
    INSERT INTO "Week" ("id", "blockId", "order") VALUES ('w1', 'b1', 1);
    INSERT INTO "Day" ("id", "weekId", "index", "label") VALUES ('d1', 'w1', 0, 'Mon');
  `);

  process.env.TURSO_DATABASE_URL = url;
  const { allows, bumpVersion, logPlan } = await import("@/lib/phone-coach");
  const { prisma } = await import("@/lib/prisma");
  const { planData } = await import("@/lib/sync-server");

  // Anna marks the session reviewed on her phone.
  const phone = { id: "anna", name: "Anna", username: "anna", isAdmin: false, sessionId: "anna-phone" };
  await prisma.$transaction([
    prisma.day.updateMany({ where: { id: "d1" }, data: { reviewedAt: new Date() } }),
    logPlan(phone, "Day", [{ id: "d1", athleteId: "a1" }]),
  ]);
  const desk = await planData(client, "anna", "anna-desk", 0, undefined, true);
  assert.ok(desk.rows.Day?.some((r) => r.id === "d1" && r.reviewedAt), "her desktop pulls the mark");
  assert.equal((await planData(client, "anna", "anna-phone", 0, undefined, true)).rows.Day, undefined, "not back to the phone");
  assert.ok((await planData(client, "ben", "ben-desk", 0, undefined, true)).rows.Day?.some((r) => r.id === "d1"), "the coach it's shared with pulls it");

  // A note: the athlete counter moves for both coaches, not for anyone else.
  await bumpVersion("a1");
  const versions = Object.fromEntries((await prisma.coach.findMany({ select: { id: true, athleteVersion: true } })).map((c) => [c.id, c.athleteVersion]));
  assert.deepEqual(versions, { anna: 1, ben: 1, cleo: 0 });

  // A meet changed on the phone comes down with its attempts; deleted, it comes down as removed.
  await client.executeMultiple(`
    INSERT INTO "Competition" ("id", "coachId", "name", "date") VALUES ('c1', 'anna', 'Nationals', 0);
    INSERT INTO "Meet" ("id", "athleteId", "name", "date", "competitionId") VALUES ('m1', 'a1', 'Nationals', 0, 'c1');
    INSERT INTO "Attempt" ("id", "meetId", "lift", "number") VALUES ('at1', 'm1', 'SQUAT', 1);
  `);
  const since = desk.rev;
  const logMeet = () =>
    prisma.$transaction([logPlan(phone, "Meet", [{ id: "m1", athleteId: "a1" }]), logPlan(phone, "Attempt", [{ id: "at1", athleteId: "a1" }])]);
  await logMeet();
  await logPlan(phone, "Competition", [{ id: "c1", athleteId: null }]);
  const meet = await planData(client, "anna", "anna-desk", since, undefined, true);
  assert.deepEqual([meet.rows.Meet?.map((r) => r.id), meet.rows.Attempt?.map((r) => r.id)], [["m1"], ["at1"]]);
  assert.deepEqual(meet.rows.Competition?.map((r) => r.id), ["c1"], "the competition, under no athlete, comes down too");
  await prisma.meet.delete({ where: { id: "m1" } });
  await logMeet();
  const gone = await planData(client, "anna", "anna-desk", meet.rev, undefined, true);
  assert.deepEqual([gone.removed.Meet, gone.removed.Attempt], [["m1"], ["at1"]]);

  // Desktop actions stay shut on the server, except inside a call the phone vouched for.
  const { assertCoach, asSignedInCoach } = await import("@/lib/role");
  assert.throws(() => assertCoach(), /Not available here/);
  await asSignedInCoach(async () => assertCoach());
  assert.throws(() => assertCoach(), /Not available here/, "only inside the call");

  assert.equal(allows("own", "edit"), true);
  assert.equal(allows("review", "review"), true);
  assert.equal(allows("review", "edit"), false);
  assert.equal(allows("view", "review"), false);

  await prisma.$disconnect();
  client.close();
});
