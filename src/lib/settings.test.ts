import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { curveHandles, estimate1RM, oneRepMaxFor, parseRpeTable, percentOf1RM, resolveDay, roundToIncrement, tableFromCurve } from "@/lib/intensity";
import { DEFAULTS, mergeSettings, parseSettings, setActiveSettings } from "@/lib/settings";

describe("parseSettings", () => {
  test("anything not stored falls back to the default", () => {
    const s = parseSettings(JSON.stringify({ roundKg: 5, newRow: { sets: 4 } }));
    assert.equal(s.roundKg, 5);
    assert.equal(s.newRow.sets, 4);
    assert.equal(s.newRow.reps, DEFAULTS.newRow.reps);
    assert.equal(s.language, "en");
  });

  test("garbage reads as the defaults", () => {
    assert.deepEqual(parseSettings("{not json"), DEFAULTS);
  });

  test("arrays replace rather than merge", () => {
    assert.deepEqual(mergeSettings(DEFAULTS, { trainingDays: [1] }).trainingDays, [1]);
  });
});

describe("rounding and estimates follow the settings", () => {
  test("the coach's rounding step", () => {
    setActiveSettings({ ...DEFAULTS, roundKg: 5 });
    assert.equal(roundToIncrement(102.4, "KG"), 100);
    setActiveSettings({ ...DEFAULTS, roundKg: 1 });
    assert.equal(roundToIncrement(102.4, "KG"), 102);
    setActiveSettings(DEFAULTS);
  });

  test("Epley works without an RPE", () => {
    setActiveSettings({ ...DEFAULTS, e1rmFormula: "epley", roundKg: 0.5 });
    // 100 × (1 + 5/30) = 116.67
    assert.equal(estimate1RM(100, 5, null, "KG"), 116.5);
    setActiveSettings(DEFAULTS);
  });

  test("the RPE chart needs an RPE", () => {
    assert.equal(estimate1RM(100, 5, null, "KG"), null);
  });
});

describe("the RPE chart", () => {
  test("a cell on the chart is used as written", () => {
    assert.equal(percentOf1RM(1, 10), 100);
    assert.equal(percentOf1RM(5, 8), 81);
    assert.equal(percentOf1RM(10, 7), 65);
    assert.equal(percentOf1RM(3, 9.5), 91);
  });

  test("off the chart, the same curve by reps to failure", () => {
    // RPE 6 × 1 leaves 4 in the tank: the same as RPE 10 × 5.
    assert.equal(percentOf1RM(1, 6), 86);
    // Between RPE 8.5 and 8 on 3 reps: halfway between 88 and 86.
    assert.equal(percentOf1RM(3, 8.25), 87);
  });

  test("nothing past where the chart reaches", () => {
    assert.equal(percentOf1RM(12, 6), null);
  });
});

test("variation drop-off: the exercise's own, else the athlete's, else the coach's", () => {
  const maxes = { squat1RM: 200, bench1RM: null, dead1RM: null, unit: "KG" as const };
  assert.equal(oneRepMaxFor("Squat", "VARIATION", maxes, "Paused Squat"), 180);
  assert.equal(oneRepMaxFor("Squat", "VARIATION", { ...maxes, variationPct: 80 }, "Paused Squat"), 160);
  const own = { ...maxes, variationPct: 80, variationPcts: '{"paused squat": 85}' };
  assert.equal(oneRepMaxFor("Squat", "VARIATION", own, "Paused Squat"), 170);
  assert.equal(oneRepMaxFor("Squat", "VARIATION", own, "Pin Squat"), 160);
  assert.equal(oneRepMaxFor("Squat", "PRIMARY", own, "Squat"), 200);
});

describe("rpe chart curve", () => {
  test("an untouched curve leaves the chart exactly as it was", () => {
    const table = DEFAULTS.rpeTable;
    assert.deepEqual(tableFromCurve(table, curveHandles(table)).pct, table.pct);
  });
  test("lowering a handle lightens the cells around it, and only those", () => {
    const table = DEFAULTS.rpeTable;
    const handles = curveHandles(table);
    const lowered = handles.map((h, i) => (i === 1 ? { ...h, y: h.y - 2 } : h));
    const out = tableFromCurve(table, lowered);
    assert.ok(out.pct[0][1] < table.pct[0][1]); // 2 @ RPE 10
    assert.equal(out.pct[6][9], table.pct[6][9]); // 10 @ RPE 7, far off
  });
  test("a chart of the athlete's own is read instead of the coach's", () => {
    const own = { ...DEFAULTS.rpeTable, pct: DEFAULTS.rpeTable.pct.map((row) => row.map((p) => p - 5)) };
    assert.equal(percentOf1RM(1, 10, own), 95);
    assert.equal(percentOf1RM(1, 10), DEFAULTS.rpeTable.pct[0][0]);
  });
  test("a malformed chart counts as none", () => {
    assert.equal(parseRpeTable("{\"rpe\":[10],\"reps\":[1,2],\"pct\":[[100]]}"), null);
    assert.equal(parseRpeTable("nope"), null);
  });
  test("a program's RPE weights come off the athlete's own chart", () => {
    const row = { id: "r", tier: "PRIMARY" as const, target: "Squat", reps: 1, intensityType: "RPE" as const, intensity: 10, intensityMax: null };
    const maxes = { squat1RM: 200, bench1RM: null, dead1RM: null, unit: "KG" as const };
    const own = { ...DEFAULTS.rpeTable, pct: DEFAULTS.rpeTable.pct.map((r) => r.map((p) => p - 10)) };
    assert.equal(resolveDay([row], maxes).get("r")?.weight, 200);
    assert.equal(resolveDay([row], { ...maxes, rpeTable: JSON.stringify(own) }).get("r")?.weight, 180);
  });
});
