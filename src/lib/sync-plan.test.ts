import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { athleteSignature, coachSignature, logChanges, mergeAthleteColumns, newerRows, stampOf, syncedTable, tableChanges, upsertSql } from "@/lib/sync-plan";

const cols = ["id", "exercise", "sets", "actualWeight", "performedRpe", "athleteNotes"];
const row = (id: string, exercise: string, actualWeight: number | null = null) => ({
  id,
  exercise,
  sets: 3,
  actualWeight,
  performedRpe: null,
  athleteNotes: null,
});

describe("tableChanges", () => {
  test("sends new and changed rows, and removes ones gone here", () => {
    const sent = new Map([
      ["a", coachSignature("ExerciseRow", row("a", "Squat"), cols)],
      ["b", coachSignature("ExerciseRow", row("b", "Bench"), cols)],
      ["gone", "x"],
    ]);
    const c = tableChanges("ExerciseRow", [row("a", "Squat"), row("b", "Bench press"), row("c", "Deadlift")], cols, sent);
    assert.deepEqual(c.upsert.map((r) => r.id), ["b", "c"]);
    assert.deepEqual(c.remove, ["gone"]);
  });

  test("an athlete column changing is not a coach change", () => {
    const sent = new Map([["a", coachSignature("ExerciseRow", row("a", "Squat"), cols)]]);
    const c = tableChanges("ExerciseRow", [row("a", "Squat", 180)], cols, sent);
    assert.equal(c.upsert.length, 0);
  });
});

describe("mergeAthleteColumns", () => {
  const sig = (w: number | null) => athleteSignature("ExerciseRow", row("a", "Squat", w));

  test("first look: the cloud's values are taken", () => {
    assert.deepEqual(mergeAthleteColumns(sig(null), sig(100), undefined), { take: true, send: false, base: sig(100) });
  });

  test("the athlete logged something: taken", () => {
    assert.deepEqual(mergeAthleteColumns(sig(null), sig(100), sig(null)), { take: true, send: false, base: sig(100) });
  });

  test("the coach edited it here: sent up", () => {
    assert.deepEqual(mergeAthleteColumns(sig(90), sig(null), sig(null)), { take: false, send: true, base: sig(90) });
  });

  test("both changed it: the athlete's wins", () => {
    assert.deepEqual(mergeAthleteColumns(sig(90), sig(100), sig(null)), { take: true, send: false, base: sig(100) });
  });

  test("nothing changed", () => {
    assert.deepEqual(mergeAthleteColumns(sig(100), sig(100), sig(100)), { take: false, send: false, base: sig(100) });
  });
});

test("an existing row's update leaves the athlete columns alone", () => {
  const sql = upsertSql("ExerciseRow", cols, 1);
  assert.match(sql, /ON CONFLICT\("id"\) DO UPDATE SET "exercise" = excluded\."exercise", "sets" = excluded\."sets"$/);
  assert.doesNotMatch(sql.split("DO UPDATE")[1], /actualWeight/);
});

test("set logs and Prisma's ledger never go up", () => {
  assert.equal(syncedTable("SetLog"), false);
  assert.equal(syncedTable("_prisma_migrations"), false);
  assert.equal(syncedTable("ExerciseRow"), true);
});

describe("logChanges", () => {
  const logCols = ["id", "rowId", "setIndex", "weight", "done"];
  const log = (id: string, setIndex: number, weight: number | null, done = false) => ({ id, rowId: "r1", setIndex, weight, done });

  test("nothing to do when both sides agree", () => {
    const same = [log("a", 0, 100, true), log("b", 1, 100)];
    assert.deepEqual(logChanges(same, same.map((l) => ({ ...l })), logCols), { insert: [], remove: [] });
  });

  test("new sets come in, gone sets go, changed sets are replaced", () => {
    const local = [log("a", 0, 100), log("b", 1, 100), log("c", 2, 100)];
    const remote = [log("a", 0, 100), log("b", 1, 105, true), log("d", 3, 90)];
    const { insert, remove } = logChanges(local, remote, logCols);
    assert.deepEqual(insert.map((l) => l.id), ["b", "d"]);
    assert.deepEqual(remove.sort(), ["b", "c"]);
  });
});

test("merged rows: only new or newer ones cross", () => {
  const held = new Map([
    ["a", Date.parse("2026-09-20T07:00:00Z")],
    ["b", Date.parse("2026-09-20T07:00:00Z")],
  ]);
  const incoming = [
    { id: "a", updatedAt: "2026-09-20T07:00:00.000+00:00" },
    { id: "b", updatedAt: "2026-09-21T07:00:00.000+00:00" },
    { id: "c", updatedAt: 5 },
  ];
  assert.deepEqual(newerRows(incoming, held).map((r) => r.id), ["b", "c"]);
  assert.equal(stampOf("nonsense"), 0);
});

test("bodyweight is merged, not pushed as a coach table", () => {
  assert.equal(syncedTable("BodyweightLog"), false);
});
