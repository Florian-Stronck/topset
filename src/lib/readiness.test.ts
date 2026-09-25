import assert from "node:assert/strict";
import { test } from "node:test";
import { asksOn, cleanScore, formatDays, parseDays, readinessScore } from "@/lib/readiness";

test("weekdays read and write back sorted, without junk", () => {
  assert.deepEqual(parseDays("3, 0,9,x,3"), [0, 3]);
  assert.deepEqual(parseDays(""), []);
  assert.equal(formatDays([4, 1, 1]), "1,4");
});

test("asked on the chosen weekdays", () => {
  // 25 Sept 2026 is a Friday (4).
  assert.equal(asksOn([4], "2026-09-25"), true);
  assert.equal(asksOn([0, 3], "2026-09-25"), false);
});

test("the score averages what was answered", () => {
  assert.equal(readinessScore({ sleep: 2, stress: 3, soreness: null, energy: 2 }), 2.3);
  assert.equal(readinessScore({ sleep: null, stress: null, soreness: null, energy: null }), null);
});

test("only whole 1–5 scores count", () => {
  assert.equal(cleanScore(3), 3);
  assert.equal(cleanScore(0), null);
  assert.equal(cleanScore(2.5), null);
  assert.equal(cleanScore("4"), null);
});
