import assert from "node:assert/strict";
import { test } from "node:test";
import { completion, formatSet, rowActuals, rpeOf } from "@/lib/setlog";

test("the row takes the heaviest finished set", () => {
  assert.deepEqual(
    rowActuals([
      { weight: 180, rpe: 7, done: true },
      { weight: 190, rpe: 8.5, done: true },
      { weight: 200, rpe: null, done: false },
    ]),
    { actualWeight: 190, performedRpe: 8.5 },
  );
});

test("on a tie, the harder set", () => {
  assert.deepEqual(
    rowActuals([
      { weight: 100, rpe: 7, done: true },
      { weight: 100, rpe: 9, done: true },
    ]),
    { actualWeight: 100, performedRpe: 9 },
  );
});

test("nothing finished clears the row", () => {
  assert.deepEqual(rowActuals([{ weight: 100, rpe: 7, done: false }]), { actualWeight: null, performedRpe: null });
});

test("completion and chips", () => {
  assert.equal(completion(0, 3), "none");
  assert.equal(completion(2, 3), "partial");
  assert.equal(completion(3, 3), "done");
  assert.equal(formatSet({ weight: 180, reps: 3, rpe: 8 }), "180×3 @8");
  assert.equal(formatSet({ weight: 60, reps: null, rpe: null }), "60");
});

test("an RIR is kept as logged and counts as its RPE for the row", () => {
  assert.equal(rpeOf({ rpe: null, rir: 2 }), 8);
  assert.equal(rpeOf({ rpe: 7.5, rir: null }), 7.5);
  assert.equal(formatSet({ weight: 150, reps: 4, rpe: null, rir: 2 }), "150×4 RIR 2");
  assert.deepEqual(
    rowActuals([
      { weight: 150, rpe: null, rir: 2, done: true },
      { weight: 150, rpe: null, rir: 1, done: true },
    ]),
    { actualWeight: 150, performedRpe: 9 },
  );
});
