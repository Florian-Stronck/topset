import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { currentAttempt, meetScore, projectedTotal, type AttemptData } from "@/lib/competition";

const attempt = (lift: AttemptData["lift"], number: number, weight: number | null, result: AttemptData["result"] = "PENDING"): AttemptData => ({
  id: `${lift}${number}`,
  lift,
  number,
  weight,
  result,
});

const dots = (...a: Parameters<typeof meetScore>) => meetScore(a[0], a[1], a[2], a[3], "dots");

describe("dots", () => {
  test("matches the published scores", () => {
    assert.ok(Math.abs((dots(700, 93, "M", "KG") as number) - 445.4) < 0.5);
    assert.ok(Math.abs((dots(400, 63, "F", "KG") as number) - 430.2) < 0.5);
  });
  test("pounds score the same as the kilos they are", () => {
    const kg = dots(700, 93, "M", "KG") as number;
    const lb = dots(700 / 0.45359237, 93 / 0.45359237, "M", "LB") as number;
    assert.ok(Math.abs(kg - lb) < 0.01);
  });
  test("nothing without a sex or bodyweight", () => {
    assert.equal(dots(700, 93, null, "KG"), null);
    assert.equal(dots(700, null, "M", "KG"), null);
  });
});

describe("gl", () => {
  test("matches the published classic scores", () => {
    assert.ok(Math.abs((meetScore(700, 93, "M", "KG", "gl") as number) - 91.57) < 0.05);
    assert.ok(Math.abs((meetScore(400, 63, "F", "KG", "gl") as number) - 87.51) < 0.05);
  });
});

describe("meet day", () => {
  const attempts = [
    attempt("SQUAT", 1, 200, "GOOD"),
    attempt("SQUAT", 2, 210, "MISS"),
    attempt("SQUAT", 3, 210),
    attempt("BENCH", 1, 130),
    attempt("DEADLIFT", 1, 250),
  ];
  test("the current attempt is the first not called", () => {
    assert.deepEqual(currentAttempt(attempts), { lift: "SQUAT", number: 3 });
  });
  test("the projected total skips misses", () => {
    assert.equal(projectedTotal(attempts), 210 + 130 + 250);
  });
});
