import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applications, describeRule, project, type BaseValues, type Rule } from "@/lib/progression";

function rule(patch: Partial<Rule>): Rule {
  return {
    id: "r",
    order: 0,
    field: "REPS",
    op: "ADD",
    amount: 1,
    everyWeeks: 1,
    startWeek: 2,
    endWeek: null,
    enabled: true,
    ...patch,
  };
}

const base: BaseValues = {
  sets: 3,
  reps: 5,
  intensity: 100,
  intensityMax: null,
  intensityType: "WEIGHT",
};

describe("applications", () => {
  test("nothing before the start week", () => {
    assert.equal(applications(rule({ startWeek: 3 }), 1), 0);
    assert.equal(applications(rule({ startWeek: 3 }), 2), 0);
  });

  test("counts cumulatively from the start week", () => {
    assert.equal(applications(rule({}), 2), 1);
    assert.equal(applications(rule({}), 3), 2);
    assert.equal(applications(rule({}), 5), 4);
  });

  test("respects the cadence", () => {
    const r = rule({ everyWeeks: 2 });
    assert.deepEqual([2, 3, 4, 5, 6].map((w) => applications(r, w)), [1, 1, 2, 2, 3]);
  });

  test("stops counting after the end week", () => {
    const r = rule({ endWeek: 3 });
    assert.equal(applications(r, 3), 2);
    assert.equal(applications(r, 6), 2);
  });

  test("an end before the start never fires", () => {
    assert.equal(applications(rule({ startWeek: 4, endWeek: 3 }), 5), 0);
  });

  test("everyWeeks of 0 is treated as 1", () => {
    assert.equal(applications(rule({ everyWeeks: 0 }), 4), 3);
  });
});

describe("project", () => {
  test("week 1 is the base", () => {
    assert.deepEqual(project(base, [rule({})], 1, "KG"), {
      sets: 3,
      reps: 5,
      intensity: 100,
      intensityMax: null,
    });
  });

  test("adds reps each week", () => {
    assert.equal(project(base, [rule({})], 4, "KG").reps, 8);
  });

  test("weights round to the plate increment", () => {
    const r = rule({ field: "INTENSITY", amount: 2 });
    assert.equal(project(base, [r], 2, "KG").intensity, 102.5);
    assert.equal(project(base, [r], 2, "LB").intensity, 100);
  });

  test("multiply compounds", () => {
    const r = rule({ field: "SETS", op: "MULTIPLY", amount: 2 });
    assert.equal(project(base, [r], 3, "KG").sets, 12);
  });

  test("sets and reps never drop below 1", () => {
    const r = rule({ field: "SETS", amount: -5 });
    assert.equal(project(base, [r], 2, "KG").sets, 1);
  });

  test("disabled rules are skipped", () => {
    assert.equal(project(base, [rule({ enabled: false })], 4, "KG").reps, 5);
  });

  test("rules apply in order, not array order", () => {
    const add = rule({ id: "a", order: 1, field: "SETS", amount: 1 });
    const mul = rule({ id: "m", order: 0, field: "SETS", op: "MULTIPLY", amount: 2 });
    // (3 × 2) + 1, not (3 + 1) × 2
    assert.equal(project(base, [add, mul], 2, "KG").sets, 7);
  });

  test("RPE clamps to 10", () => {
    const rpe: BaseValues = { ...base, intensity: 9, intensityType: "RPE" };
    const r = rule({ field: "INTENSITY", amount: 0.5 });
    assert.equal(project(rpe, [r], 5, "KG").intensity, 10);
  });

  test("RIR clamps to 0", () => {
    const rir: BaseValues = { ...base, intensity: 1, intensityType: "RIR" };
    const r = rule({ field: "INTENSITY", amount: -1 });
    assert.equal(project(rir, [r], 4, "KG").intensity, 0);
  });

  test("a range keeps its width", () => {
    const range: BaseValues = { ...base, intensity: 100, intensityMax: 110, intensityType: "RANGE" };
    const r = rule({ field: "INTENSITY", amount: 5 });
    const out = project(range, [r], 3, "KG");
    assert.equal(out.intensity, 110);
    assert.equal(out.intensityMax, 120);
  });

  test("null values stay null", () => {
    const empty: BaseValues = { ...base, reps: null };
    assert.equal(project(empty, [rule({})], 3, "KG").reps, null);
  });
});

describe("describeRule", () => {
  test("presets read naturally", () => {
    assert.equal(describeRule(rule({}), "WEIGHT"), "+1 rep/wk");
    assert.equal(describeRule(rule({ amount: 2 }), "WEIGHT"), "+2 reps/wk");
    assert.equal(describeRule(rule({ field: "INTENSITY", amount: 2.5 }), "WEIGHT"), "+2.5kg/wk");
    assert.equal(describeRule(rule({ field: "INTENSITY", amount: 0.5 }), "RPE"), "+0.5 RPE/wk");
    assert.equal(
      describeRule(rule({ field: "SETS", op: "MULTIPLY", amount: 0.6, startWeek: 4, endWeek: 4 }), "WEIGHT"),
      "×0.6 set/wk (wk 4 only)",
    );
  });

  test("negative amounts use a real minus sign", () => {
    assert.equal(describeRule(rule({ amount: -1 }), "WEIGHT"), "−1 rep/wk");
  });
});
