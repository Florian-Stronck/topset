import assert from "node:assert/strict";
import { test } from "node:test";
import { complianceByWeek, intensityZones, liftWeekTable, rowTonnage, rpeByWeek, weeklyTonnage } from "@/lib/progress";
import type { SetLogData } from "@/lib/setlog";
import type { AthleteData, BlockData, RowData } from "@/lib/types";

const athlete: AthleteData = { id: "a", name: "Ann", unit: "KG", squat1RM: 200, bench1RM: 120, dead1RM: 240 };

const log = (setIndex: number, weight: number, reps: number, done = true): SetLogData => ({
  id: `l${setIndex}`,
  setIndex,
  weight,
  reps,
  rpe: 8,
  rir: null,
  done,
  pr: false,
  loggedAt: "2026-09-21T18:00:00.000Z",
});

const row = (over: Partial<RowData> = {}): RowData => ({
  id: "r",
  order: 0,
  rules: [],
  tier: "PRIMARY",
  target: "Squat",
  exercise: "Squat",
  fromId: null,
  sets: 3,
  reps: 5,
  intensityType: "RPE",
  intensity: 8,
  intensityMax: null,
  rampStep: null,
  coachNotes: null,
  tempo: null,
  restTime: null,
  videoUrl: null,
  actualWeight: null,
  performedRpe: null,
  athleteNotes: null,
  ...over,
});

// Monday 14 Sept 2026, two weeks, sessions on Monday and Wednesday.
const block = (weeks: RowData[][][]): BlockData => ({
  id: "b",
  phase: "Base",
  program: { id: "p", name: "Plan" },
  order: 0,
  startDate: "2026-09-14T00:00:00.000Z",
  squat1RM: null,
  bench1RM: null,
  dead1RM: null,
  weeks: weeks.map((days, w) => ({
    id: `w${w}`,
    order: w + 1,
    locked: false,
    days: days.map((rows, d) => ({ id: `d${w}${d}`, index: d * 2, label: `S${d}`, rest: false, rows })),
  })),
});

test("tonnage counts the sets done, else every set at the typed-in weight", () => {
  assert.equal(rowTonnage(row({ logs: [log(0, 100, 5), log(1, 100, 5), log(2, 100, 5, false)] })), 1000);
  assert.equal(rowTonnage(row({ actualWeight: 100 })), 1500);
  assert.equal(rowTonnage(row()), 0);
});

test("weekly tonnage splits by lift, or by target as written", () => {
  const b = block([[[row({ actualWeight: 100 }), row({ target: "Back", exercise: "Row", tier: "ACCESSORY", actualWeight: 50, sets: 2, reps: 10 })]]]);
  assert.deepEqual(weeklyTonnage(b, "lift")[0].parts, { Squat: 1500, Other: 1000 });
  assert.deepEqual(weeklyTonnage(b, "target")[0].parts, { Squat: 1500, Back: 1000 });
});

test("RPE by week compares like with like, per lift", () => {
  const b = block([[[row({ performedRpe: 9 }), row({ target: "Bench", intensity: 7, performedRpe: 7 }), row({ intensityType: "PERCENT", intensity: 75, performedRpe: 9 })]]]);
  assert.deepEqual(rpeByWeek(b, "squat")[0], { week: 1, planned: 8, actual: 9, n: 1 });
  assert.deepEqual(rpeByWeek(b, "all")[0], { week: 1, planned: 7.5, actual: 8, n: 2 });
});

test("compliance only counts sessions that were due", () => {
  // Week 1: Monday done, Wednesday missed. Week 2 hasn't started by Friday of week 1.
  const b = block([
    [[row({ actualWeight: 100 })], [row()]],
    [[row()], [row()]],
  ]);
  const weeks = complianceByWeek(b, "2026-09-18");
  assert.deepEqual(weeks[0], { week: 1, done: 3, due: 6, pct: 50, missed: 1 });
  assert.deepEqual(weeks[1], { week: 2, done: 0, due: 0, pct: null, missed: 0 });
});

test("intensity zones sort the sets done by %1RM of the max each row is written off", () => {
  const b = block([[[row({ logs: [log(0, 130, 5), log(1, 150, 5), log(2, 170, 3), log(3, 185, 1)] }), row({ target: "Biceps", tier: "ACCESSORY", actualWeight: 20 })]]]);
  assert.deepEqual(intensityZones(b, athlete, "all")[0].parts, { "<70%": 1, "70–80%": 1, "80–90%": 1, "90%+": 1 });
  assert.deepEqual(intensityZones(b, athlete, "bench")[0].parts, { "<70%": 0, "70–80%": 0, "80–90%": 0, "90%+": 0 });
});

test("the lift table takes the top set off competition rows but the work off every row", () => {
  const b = block([[[row({ logs: [log(0, 170, 5), log(1, 175, 5)] }), row({ tier: "VARIATION", exercise: "Pause squat", actualWeight: 150, performedRpe: 9, sets: 2, reps: 3 })]]]);
  const [week] = liftWeekTable(b, athlete, "squat");
  assert.deepEqual(week.top, { weight: 175, reps: 5, rpe: 8 });
  assert.ok(week.e1rm !== null && week.e1rm > 175);
  assert.equal(week.setsDone, 4);
  assert.equal(week.setsPrescribed, 5);
  assert.equal(week.tonnage, 170 * 5 + 175 * 5 + 150 * 2 * 3);
  assert.equal(week.rpeDelta, 1);
});
