import assert from "node:assert/strict";
import { test } from "node:test";
import { completionPct, dayStatus, daySets, offPlan, prescribedRpe, rowSets, rpeDrift, type ComplianceRow } from "@/lib/compliance";

const row = (over: Partial<ComplianceRow> = {}): ComplianceRow => ({
  exercise: "Squat",
  sets: 3,
  intensityType: "RPE",
  intensity: 8,
  intensityMax: null,
  actualWeight: null,
  performedRpe: null,
  ...over,
});

test("sets done come from ticked sets, else a typed-in weight counts the row", () => {
  assert.deepEqual(rowSets(row({ logs: [{ done: true }, { done: false }] })), { prescribed: 3, done: 1 });
  assert.deepEqual(rowSets(row({ actualWeight: 100 })), { prescribed: 3, done: 3 });
  assert.deepEqual(rowSets(row({ logs: [{ done: true }, { done: true }, { done: true }, { done: true }] })), { prescribed: 3, done: 3 });
  assert.deepEqual(rowSets(row({ sets: null })), { prescribed: 1, done: 0 });
});

test("a day's sets skip the empty row at the bottom", () => {
  assert.deepEqual(daySets([row({ actualWeight: 100 }), row({ exercise: " " })]), { prescribed: 3, done: 3 });
});

test("day status", () => {
  const today = "2026-09-25";
  assert.equal(dayStatus("2026-09-24", today, { prescribed: 5, done: 0 }, true), "missed");
  assert.equal(dayStatus("2026-09-25", today, { prescribed: 5, done: 0 }, true), "today");
  assert.equal(dayStatus("2026-09-26", today, { prescribed: 5, done: 0 }, true), "upcoming");
  assert.equal(dayStatus("2026-09-24", today, { prescribed: 5, done: 2 }, true), "partial");
  assert.equal(dayStatus("2026-09-24", today, { prescribed: 5, done: 5 }, true), "done");
  assert.equal(dayStatus("2026-09-24", today, null, true), "rest");
  assert.equal(dayStatus("2026-09-24", today, null, false), "none");
});

test("completion is over the sets due", () => {
  assert.equal(completionPct([]), null);
  assert.equal(completionPct([{ prescribed: 4, done: 4 }, { prescribed: 4, done: 2 }]), 75);
});

test("RIR reads as its RPE, and a range as its top", () => {
  assert.equal(prescribedRpe(row({ intensityType: "RIR", intensity: 2 })), 8);
  assert.equal(prescribedRpe(row({ intensity: 7, intensityMax: 8 })), 8);
  assert.equal(prescribedRpe(row({ intensityType: "PERCENT", intensity: 80 })), null);
});

test("drift averages logged minus prescribed", () => {
  assert.deepEqual(rpeDrift([row({ performedRpe: 9 }), row({ performedRpe: 9.5 }), row()]), { mean: 1.3, n: 2 });
  assert.deepEqual(rpeDrift([row()]), { mean: null, n: 0 });
});

test("off plan: missed, under target, or RPE over", () => {
  assert.deepEqual(offPlan(row(), 100, true), { level: "miss", reasons: ["missed"] });
  assert.equal(offPlan(row(), 100, false), null);
  assert.deepEqual(offPlan(row({ actualWeight: 94, performedRpe: 8 }), 100, true), { level: "warn", reasons: ["under"] });
  assert.equal(offPlan(row({ actualWeight: 96, performedRpe: 8.5 }), 100, true), null);
  assert.deepEqual(offPlan(row({ actualWeight: 100, performedRpe: 9 }), 100, true), { level: "warn", reasons: ["rpe"] });
});
