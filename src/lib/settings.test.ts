import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { estimate1RM, percentOf1RM, roundToIncrement } from "@/lib/intensity";
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
