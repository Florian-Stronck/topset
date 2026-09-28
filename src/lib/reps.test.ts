import assert from "node:assert/strict";
import test from "node:test";
import { parseReps, repsText } from "@/lib/reps";

test("reps read as a number or a range", () => {
  assert.deepEqual(parseReps("8"), { reps: 8, repsMax: null });
  assert.deepEqual(parseReps("8-10"), { reps: 8, repsMax: 10 });
  assert.deepEqual(parseReps("8 – 10"), { reps: 8, repsMax: 10 });
  assert.deepEqual(parseReps("12 to 8"), { reps: 8, repsMax: 12 });
  assert.deepEqual(parseReps("5-5"), { reps: 5, repsMax: null });
  assert.deepEqual(parseReps(""), { reps: null, repsMax: null });
  assert.equal(parseReps("lots"), null);
  assert.equal(parseReps("0"), null);
});

test("reps print back the way they were typed", () => {
  assert.equal(repsText({ reps: 8, repsMax: 10 }), "8–10");
  assert.equal(repsText({ reps: 5, repsMax: null }), "5");
  assert.equal(repsText({ reps: null }), "—");
  assert.deepEqual(parseReps(repsText({ reps: 6, repsMax: 8 })), { reps: 6, repsMax: 8 });
});
