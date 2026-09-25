import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyweightSummary, classLimit, dailyWeights, projectWeight, rollingAverage } from "@/lib/bodyweight";

test("the last weigh-in of a day stands for it", () => {
  const daily = dailyWeights([
    { day: "2026-09-02", weight: 84, createdAt: "2026-09-02T07:00:00Z" },
    { day: "2026-09-01", weight: 83, createdAt: "2026-09-01T07:00:00Z" },
    { day: "2026-09-02", weight: 85, createdAt: "2026-09-02T20:00:00Z" },
  ]);
  assert.deepEqual(daily, [
    { day: "2026-09-01", weight: 83 },
    { day: "2026-09-02", weight: 85 },
  ]);
});

test("7-day averages and the week-on-week change", () => {
  const daily = [
    { day: "2026-09-10", weight: 84 },
    { day: "2026-09-11", weight: 86 },
    { day: "2026-09-18", weight: 83 },
    { day: "2026-09-19", weight: 83.5 },
  ];
  assert.deepEqual(rollingAverage(daily).map((d) => d.weight), [84, 85, 83, 83.3]);
  const s = bodyweightSummary(daily, "2026-09-20");
  assert.deepEqual(s.latest, { day: "2026-09-19", weight: 83.5 });
  assert.equal(s.age, 1);
  assert.equal(s.avg7, 83.3);
  assert.equal(s.change7, -1.7);
  assert.deepEqual(bodyweightSummary([], "2026-09-20"), { latest: null, age: null, avg7: null, change7: null });
});

test("weight classes read their upper limit", () => {
  assert.equal(classLimit("83"), 83);
  assert.equal(classLimit("-83"), 83);
  assert.equal(classLimit("u83"), 83);
  assert.equal(classLimit("83 kg"), 83);
  assert.equal(classLimit("52,5"), 52.5);
  assert.equal(classLimit("120+"), null);
  assert.equal(classLimit("+120"), null);
  assert.equal(classLimit("SHW"), null);
  assert.equal(classLimit(null), null);
});

test("the trend carried forward to a meet", () => {
  // Losing 0.1 a day: 0.7 a week.
  const daily = Array.from({ length: 15 }, (_, i) => ({
    day: `2026-09-${String(6 + i).padStart(2, "0")}`,
    weight: Math.round((86 - i * 0.1) * 10) / 10,
  }));
  assert.deepEqual(projectWeight(daily, "2026-09-20", "2026-10-04"), { weight: 83.2, perWeek: -0.7 });
  // Too few weigh-ins, or all in a few days, isn't a trend.
  assert.equal(projectWeight(daily.slice(-3), "2026-09-20", "2026-10-04"), null);
  assert.equal(projectWeight(daily.slice(-5), "2026-09-20", "2026-10-04"), null);
});
