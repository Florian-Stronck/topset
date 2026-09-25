import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPush, ownedIdsSql } from "@/lib/coach-scope";

const owned = new Map([
  ["Coach", new Set(["me"])],
  ["Athlete", new Set(["a1"])],
  ["Program", new Set(["p1"])],
  ["Block", new Set(["b1"])],
  ["Week", new Set(["w1"])],
  ["Day", new Set(["d1"])],
  ["ExerciseRow", new Set(["r1"])],
]);
const none = new Set<string>();

test("a new row under something of mine is fine", () => {
  assert.equal(checkPush("me", { ExerciseRow: { upsert: [{ id: "r2", dayId: "d1", fromId: null }], remove: [] } }, owned, none), null);
});

test("a whole new athlete with its tree in one push is fine", () => {
  const tables = {
    Athlete: { upsert: [{ id: "a2", coachId: "me" }], remove: [] },
    Program: { upsert: [{ id: "p2", athleteId: "a2" }], remove: [] },
    Block: { upsert: [{ id: "b2", athleteId: "a2", programId: "p2" }], remove: [] },
    Week: { upsert: [{ id: "w2", blockId: "b2" }], remove: [] },
  };
  assert.equal(checkPush("me", tables, owned, none), null);
});

test("hanging a row off someone else's day is refused", () => {
  assert.match(String(checkPush("me", { ExerciseRow: { upsert: [{ id: "r9", dayId: "theirs" }], remove: [] } }, owned, none)), /isn't yours/);
});

test("overwriting someone else's row by its id is refused", () => {
  assert.match(
    String(checkPush("me", { ExerciseRow: { upsert: [{ id: "x", dayId: "d1" }], remove: [] } }, owned, new Set(["x"]))),
    /belongs to someone else/,
  );
});

test("an athlete moved to another coach is refused", () => {
  assert.match(String(checkPush("me", { Athlete: { upsert: [{ id: "a1", coachId: "other" }], remove: [] } }, owned, none)), /isn't yours/);
});

test("removing someone else's row is refused", () => {
  assert.match(String(checkPush("me", { Week: { upsert: [], remove: ["theirs"] } }, owned, none)), /isn't yours to remove/);
});

test("changing another coach's profile, or logged sets, is refused", () => {
  assert.match(String(checkPush("me", { Coach: { upsert: [{ id: "other" }], remove: [] } }, owned, none)), /own coach profile/);
  assert.match(String(checkPush("me", { SetLog: { upsert: [], remove: [] } }, owned, none)), /can't be synced/);
  assert.match(String(checkPush("me", { Invite: { upsert: [], remove: [] } }, owned, none)), /can't be synced/);
});

test("ownership walks up to the coach", () => {
  assert.equal(
    ownedIdsSql("Week"),
    'SELECT "id" FROM "Week" WHERE "blockId" IN (SELECT "id" FROM "Block" WHERE "athleteId" IN (SELECT "id" FROM "Athlete" WHERE "coachId" IN (SELECT "id" FROM "Coach" WHERE "id" = ?)))',
  );
});
