import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseHistory } from "@/lib/exercise-history";

const row = (id: string, exercise: string, actualWeight: number | null) => ({
  id,
  tier: "VARIATION" as const,
  target: "Squat",
  exercise,
  sets: 3,
  reps: 5,
  intensityType: "RPE" as const,
  intensity: 8,
  intensityMax: null,
  rampStep: null,
  actualWeight,
  performedRpe: 8,
});

const block = (name: string, start: string, rows: ReturnType<typeof row>[]) => ({
  phase: name,
  program: { name: "Prep" },
  startDate: new Date(`${start}T00:00:00Z`),
  squat1RM: 200,
  bench1RM: null,
  dead1RM: null,
  weeks: [{ order: 1, days: [{ index: 2, rest: false, rows }] }],
});

test("every logged set of an exercise, oldest first, across phases", () => {
  const history = exerciseHistory(
    [
      block("Peak", "2026-09-14", [row("b", "paused  squat", 160)]),
      block("Base", "2026-09-07", [row("a", "Paused Squat", 150), row("c", "Leg Press", null)]),
    ],
    { id: "x", name: "A", unit: "KG", squat1RM: 200, bench1RM: null, dead1RM: null },
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].name, "paused squat");
  assert.deepEqual(history[0].logs.map((l) => [l.ymd, l.weight, l.where]), [
    ["2026-09-09", 150, "Prep · Base"],
    ["2026-09-16", 160, "Prep · Peak"],
  ]);
  assert.ok(history[0].logs[0].e1rm! > 150);
});
