import assert from "node:assert/strict";
import { test } from "node:test";
import { sortVolume, weeklyVolume } from "@/lib/volume";
import type { RowData } from "@/lib/types";

const row = (target: string, sets: number, done = false, exercise = target): RowData =>
  ({
    id: `${target}-${sets}`,
    order: 0,
    rules: [],
    tier: "PRIMARY",
    target,
    exercise,
    fromId: null,
    sets,
    reps: 5,
    intensityType: "RPE",
    intensity: 8,
    intensityMax: null,
    rampStep: null,
    coachNotes: null,
    tempo: null,
    restTime: null,
    videoUrl: null,
    actualWeight: done ? 100 : null,
    performedRpe: null,
    athleteNotes: null,
  }) as RowData;

const block = {
  weeks: [
    {
      id: "w1",
      order: 1,
      locked: false,
      days: [
        { id: "d1", index: 0, label: "A", rest: false, rows: [row("Bench", 4, true), row("chest", 3), row("Squat", 5), row("", 2, false, "Plank")] },
        { id: "d2", index: 1, label: "Rest", rest: true, rows: [row("Squat", 9)] },
      ],
    },
    { id: "w2", order: 2, locked: false, days: [{ id: "d3", index: 0, label: "A", rest: false, rows: [row("Deadlift", 3)] }] },
  ],
};

test("sets per target, with the main lifts counted toward Chest and Legs too", () => {
  const volume = new Map(weeklyVolume(block).map((r) => [r.target, r]));
  assert.deepEqual(volume.get("Bench")?.weeks[1], { planned: 4, done: 4 });
  // A "chest" target the coach wrote takes the bench sets in, whatever its case.
  assert.deepEqual(volume.get("chest")?.weeks[1], { planned: 7, done: 4 });
  assert.equal(volume.get("chest")?.derived, true);
  assert.deepEqual(volume.get("Legs")?.weeks, { 1: { planned: 5, done: 0 }, 2: { planned: 3, done: 0 } });
  assert.deepEqual(volume.get("No target")?.total, { planned: 2, done: 0 });
  // A rest day's rows don't count.
  assert.equal(volume.get("Squat")?.total.planned, 5);
});

test("sorting by name or by sets", () => {
  const rows = weeklyVolume(block);
  assert.deepEqual(sortVolume(rows, { by: "target" }, false).map((r) => r.target), ["Bench", "chest", "Deadlift", "Legs", "No target", "Squat"]);
  assert.equal(sortVolume(rows, { by: "total" }, true)[0].target, "Legs");
  assert.equal(sortVolume(rows, { by: "week", week: 2 }, true)[0].target, "Deadlift");
});
