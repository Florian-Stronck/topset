import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerDay,
  asksOn,
  cleanAnswer,
  formatAnswer,
  formatDays,
  parseConfig,
  parseDays,
  readinessOf,
  scaleScore,
  type CheckinQuestionData,
} from "@/lib/checkins";

const q = (over: Partial<CheckinQuestionData>): CheckinQuestionData => ({
  id: "q",
  label: "Q",
  cadence: "DAILY",
  days: [],
  kind: "SCALE",
  config: { min: 1, max: 5 },
  icon: "check",
  color: "blue",
  order: 0,
  archived: false,
  ...over,
});

test("weekdays read and write back sorted, without junk", () => {
  assert.deepEqual(parseDays("3, 0,9,x,3"), [0, 3]);
  assert.deepEqual(parseDays(""), []);
  assert.equal(formatDays([4, 1, 1]), "1,4");
});

test("a daily question is asked every day, or on the weekdays picked", () => {
  // 25 Sept 2026 is a Friday (4).
  assert.equal(asksOn(q({}), "2026-09-25"), true);
  assert.equal(asksOn(q({ days: [4] }), "2026-09-25"), true);
  assert.equal(asksOn(q({ days: [0, 3] }), "2026-09-25"), false);
  assert.equal(asksOn(q({ archived: true }), "2026-09-25"), false);
});

test("a weekly question opens on its day and stays open to Sunday, filed under that day", () => {
  const weekly = q({ cadence: "WEEKLY", days: [2] });
  assert.equal(asksOn(weekly, "2026-09-22"), false); // Tuesday
  assert.equal(asksOn(weekly, "2026-09-23"), true); // Wednesday
  assert.equal(asksOn(weekly, "2026-09-27"), true); // Sunday
  assert.equal(answerDay(weekly, "2026-09-26"), "2026-09-23");
  assert.equal(answerDay(q({}), "2026-09-26"), "2026-09-26");
});

test("answers that don't fit the question are no answer", () => {
  assert.equal(cleanAnswer(q({}), 3), "3");
  assert.equal(cleanAnswer(q({}), 7), null);
  assert.equal(cleanAnswer(q({}), 2.5), null);
  assert.equal(cleanAnswer(q({ kind: "NUMBER" }), "8,5"), "8.5");
  assert.equal(cleanAnswer(q({ kind: "NUMBER" }), ""), null);
  const single = q({ kind: "SINGLE", config: { options: ["A", "B"] } });
  assert.equal(cleanAnswer(single, "B"), "B");
  assert.equal(cleanAnswer(single, "C"), null);
  const multi = q({ kind: "MULTI", config: { options: ["A", "B", "C"] } });
  assert.equal(cleanAnswer(multi, ["C", "A", "Z"]), '["A","C"]');
  assert.equal(cleanAnswer(multi, []), null);
  assert.equal(cleanAnswer(q({ kind: "YESNO" }), true), "yes");
  assert.equal(cleanAnswer(q({ kind: "TEXT" }), "  hi "), "hi");
});

test("settings are cleaned per kind", () => {
  assert.deepEqual(parseConfig("SCALE", '{"min":3,"max":1}'), { min: 1, max: 5 });
  assert.deepEqual(parseConfig("SCALE", '{"min":0,"max":10,"low":" bad "}'), { min: 0, max: 10, low: "bad" });
  assert.deepEqual(parseConfig("MULTI", { options: ["A", "A", " ", "B"] }), { options: ["A", "B"] });
  assert.deepEqual(parseConfig("NUMBER", "not json"), {});
});

test("scales of any range read on 1–5, and the day's readiness averages them", () => {
  assert.equal(scaleScore(q({ config: { min: 0, max: 10 } }), "5"), 3);
  assert.equal(scaleScore(q({ kind: "NUMBER" }), "5"), null);
  const sleep = q({ id: "s", label: "Sleep" });
  const energy = q({ id: "e", label: "Energy" });
  const steps = q({ id: "n", kind: "NUMBER", config: { unit: "steps" } });
  const day = readinessOf(
    [sleep, energy, steps],
    [
      { id: "1", questionId: "s", day: "d", value: "1" },
      { id: "2", questionId: "e", day: "d", value: "4" },
      { id: "3", questionId: "n", day: "d", value: "9000" },
    ],
  );
  assert.equal(day.score, 2.5);
  assert.deepEqual(day.low, [{ label: "Sleep", value: "1/5" }]);
  assert.equal(formatAnswer(steps, "9000"), "9000 steps");
});
