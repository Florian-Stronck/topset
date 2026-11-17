import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { currentAttempt, meetScore, openersSet, parseRacks, projectedTotal, rackBrand, rackFor, ratesByNumber, thirdFor, thirdsByLift, totalOf, weightOf, type AttemptData } from "@/lib/competition";

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

describe("planning a meet", () => {
  test("thirds sit one jump either side of the plan", () => {
    assert.equal(thirdFor("planned", 170, "KG"), 170);
    assert.equal(thirdFor("safe", 170, "KG"), 167.5);
    assert.equal(thirdFor("push", 170, "KG"), 172.5);
    assert.equal(thirdFor("push", 400, "LB"), 405);
    assert.equal(thirdFor("push", null, "KG"), null);
  });
  test("a total needs every totalled lift", () => {
    const attempts = [attempt("SQUAT", 3, 170), attempt("BENCH", 3, 87.5), attempt("DEADLIFT", 3, 182.5)];
    assert.equal(totalOf((l) => weightOf(attempts, l, 3)), 440);
    assert.equal(totalOf((l) => weightOf(attempts, l, 2)), null);
  });
});

describe("meet history", () => {
  const meets = [
    { attempts: [attempt("SQUAT", 1, 150, "GOOD"), attempt("SQUAT", 3, 165, "MISS"), attempt("DEADLIFT", 3, 175, "GOOD")] },
    { attempts: [attempt("SQUAT", 1, 155, "GOOD"), attempt("SQUAT", 3, 170, "GOOD"), attempt("BENCH", 3, 90)] },
  ];
  test("pending attempts count for neither side", () => {
    assert.deepEqual(ratesByNumber(meets), [
      { made: 2, called: 2 },
      { made: 0, called: 0 },
      { made: 2, called: 3 },
    ]);
  });
  test("thirds are split by lift", () => {
    const thirds = thirdsByLift(meets);
    assert.deepEqual(thirds.SQUAT, { made: 1, called: 2 });
    assert.deepEqual(thirds.BENCH, { made: 0, called: 0 });
    assert.deepEqual(thirds.DEADLIFT, { made: 1, called: 1 });
  });
});

describe("rack heights", () => {
  const racks = parseRacks('{"Eleiko":{"squat":"12","bench":" 8 ","safety":""},"":{"squat":"1"},"Rogue":null}');
  test("kept per brand, blanks as none", () => {
    assert.deepEqual(racks.Eleiko, { squat: "12", bench: "8", safety: null });
    assert.equal("" in racks, false);
    assert.deepEqual(parseRacks("nope"), {});
  });
  test("a brand finds its heights however it's capitalised", () => {
    assert.equal(rackBrand(racks, " eleiko "), "Eleiko");
    assert.equal(rackBrand(racks, "Werksan"), "Werksan");
    assert.equal(rackBrand(racks, "  "), null);
    assert.equal(rackFor(racks, "ELEIKO").squat, "12");
    assert.deepEqual(rackFor(racks, null), { squat: null, bench: null, safety: null });
  });
});

describe("openers set", () => {
  test("counts lifts whose first attempt has a weight", () => {
    assert.equal(openersSet([]), 0);
    assert.equal(openersSet([attempt("SQUAT", 1, 200), attempt("BENCH", 1, null), attempt("BENCH", 2, 130), attempt("DEADLIFT", 1, 250)]), 2);
    assert.equal(openersSet([attempt("SQUAT", 1, 200), attempt("BENCH", 1, 120), attempt("DEADLIFT", 1, 250)]), 3);
  });
});
