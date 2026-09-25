import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, dateOfDay, nextSession, previousSession, sessionOn, sessionsOf } from "@/lib/schedule";

const day = (id: string, index: number, rest = false) => ({ id, index, rest });

describe("dateOfDay", () => {
  test("counts weeks and days from the start", () => {
    assert.equal(dateOfDay("2026-09-21T00:00:00Z", 1, 0), "2026-09-21");
    assert.equal(dateOfDay("2026-09-21T00:00:00Z", 2, 3), "2026-10-01");
  });

  test("reads a start saved as local midnight as the same day", () => {
    assert.equal(dateOfDay("2026-09-20T22:00:00Z", 1, 0), "2026-09-21");
  });
});

describe("sessionsOf", () => {
  const base = {
    id: "base",
    startDate: "2026-09-21T00:00:00Z",
    weeks: [
      { order: 1, days: [day("a", 0), day("r", 1, true), day("b", 2)] },
      { order: 2, days: [day("c", 0), day("d", 2)] },
    ],
  };

  test("lists training days in date order, skipping rest days", () => {
    const s = sessionsOf([base]);
    assert.deepEqual(
      s.map((x) => [x.ymd, x.day.id, x.week]),
      [
        ["2026-09-21", "a", 1],
        ["2026-09-23", "b", 1],
        ["2026-09-28", "c", 2],
        ["2026-09-30", "d", 2],
      ],
    );
  });

  test("a later-starting overlapping phase wins the shared date", () => {
    const peak = { id: "peak", startDate: "2026-09-28T00:00:00Z", weeks: [{ order: 1, days: [day("p", 0)] }] };
    const s = sessionsOf([peak, base]);
    assert.equal(sessionOn(s, "2026-09-28")?.day.id, "p");
    assert.equal(sessionOn(s, "2026-09-30")?.day.id, "d");
  });

  test("finds today, the next and the previous session", () => {
    const s = sessionsOf([base]);
    assert.equal(sessionOn(s, "2026-09-22"), null);
    assert.equal(nextSession(s, "2026-09-22")?.day.id, "b");
    assert.equal(previousSession(s, "2026-09-22")?.day.id, "a");
    assert.equal(nextSession(s, "2026-09-30"), null);
  });
});

test("addDays crosses months", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-10-01", -1), "2026-09-30");
});
