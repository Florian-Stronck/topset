import assert from "node:assert/strict";
import { test } from "node:test";
import { bucket, computeMetrics, fitLine, type MetricBlock } from "@/lib/metrics";
import type { CheckinQuestionData } from "@/lib/checkins";
import type { AthleteData } from "@/lib/types";

const athlete: AthleteData = { id: "a", name: "Ann", unit: "KG", squat1RM: 200, bench1RM: 120, dead1RM: 240, variationPct: null, variationPcts: null };

const row = {
  id: "r1",
  tier: "PRIMARY" as const,
  target: "Squat",
  exercise: "Squat",
  sets: 3,
  reps: 5,
  intensityType: "RPE" as const,
  intensity: 8,
  intensityMax: null,
  rampStep: null,
  actualWeight: 160,
  performedRpe: 8,
  logs: [
    { weight: 150, reps: 5, rpe: 7, rir: null, done: true, pr: false },
    { weight: 160, reps: 5, rpe: 8, rir: null, done: true, pr: true },
    { weight: null, reps: null, rpe: null, rir: null, done: false, pr: false },
  ],
};

// Monday 2026-09-21, one session on its first day.
const phase: MetricBlock = {
  phase: "Strength",
  program: { name: "Prep" },
  startDate: new Date("2026-09-21T00:00:00Z"),
  squat1RM: null,
  bench1RM: null,
  dead1RM: null,
  weeks: [{ order: 1, days: [{ id: "d1", index: 0, rest: false, rows: [row] }] }],
};

const sleep: CheckinQuestionData = { id: "q1", label: "Sleep", cadence: "DAILY", days: [], kind: "SCALE", config: { min: 1, max: 10 }, icon: "", color: "blue", order: 0, archived: false };

test("every source lands on the calendar, by name", () => {
  const { defs, points } = computeMetrics({
    phases: [phase],
    athlete,
    bodyweights: [
      { id: "b1", day: "2026-09-21", weight: 80, note: null, source: "athlete", createdAt: "2026-09-21T07:00:00Z" },
      { id: "b2", day: "2026-09-21", weight: 80.4, note: null, source: "athlete", createdAt: "2026-09-21T08:00:00Z" },
    ],
    nutrition: [{ id: "n", day: "2026-09-22", kcal: 3000, protein: 180, carbs: null, fat: null, source: "athlete" }],
    targets: [],
    questions: [sleep],
    answers: [{ id: "x", questionId: "q1", day: "2026-09-22", value: "7", updatedAt: "" }],
    injuries: [{ id: "i", area: "knee", side: "L", day: "2026-09-23", endDay: null, severity: 3, note: null, source: "athlete" }],
    today: "2026-09-24",
  });
  assert.deepEqual(points.tonnage, [["2026-09-21", 1550]]);
  assert.deepEqual(points["sets-done"], [["2026-09-21", 2]]);
  assert.deepEqual(points.compliance, [["2026-09-21", 67]]);
  assert.deepEqual(points["top:squat"], [["2026-09-21", 160]]);
  assert.deepEqual(points["top-ex:squat"], [["2026-09-21", 160]]);
  assert.deepEqual(points["top-pct:squat"], [["2026-09-21", 80]]);
  assert.deepEqual(points["top-rpe:squat"], [["2026-09-21", 8]]);
  assert.deepEqual(points.prs, [["2026-09-21", 1]]);
  assert.deepEqual(points.bw, [["2026-09-21", 80.4]]);
  assert.deepEqual(points.kcal, [["2026-09-22", 3000]]);
  assert.deepEqual(points["q:sleep"], [["2026-09-22", 7]]);
  assert.deepEqual(points["injury-severity"], [["2026-09-23", 3], ["2026-09-24", 3]]);
  // Only measures with something logged are offered.
  assert.ok(defs.some((d) => d.id === "q:sleep"));
  assert.ok(!defs.some((d) => d.id === "fat"));
});

test("bucket pools days into weeks and leaves gaps empty", () => {
  const points: [string, number][] = [["2026-09-21", 2], ["2026-09-23", 4], ["2026-10-05", 10]];
  assert.deepEqual(bucket(points, "week", "sum", "2026-09-21", "2026-10-11"), [
    { key: "2026-09-21", value: 6 },
    { key: "2026-09-28", value: null },
    { key: "2026-10-05", value: 10 },
  ]);
  assert.deepEqual(bucket(points, "week", "avg", "2026-09-21", "2026-09-27"), [{ key: "2026-09-21", value: 3 }]);
  assert.equal(bucket(points, "day", "sum", "2026-09-21", "2026-09-23").length, 3);
});

test("fitLine finds the trend and how well it holds", () => {
  const exact = fitLine([[0, 1], [1, 3], [2, 5]]);
  assert.deepEqual(exact, { slope: 2, intercept: 1, r2: 1 });
  const noisy = fitLine([[0, 0], [1, 2], [2, 1], [3, 3]])!;
  assert.ok(noisy.slope > 0 && noisy.r2 > 0 && noisy.r2 < 1);
  assert.equal(fitLine([[1, 1]]), null);
  assert.equal(fitLine([[1, 1], [1, 2]]), null);
});
