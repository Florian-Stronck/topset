import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, dateOfDay, nextSession, previousSession, sessionOn, sessionsOf, weekOn } from "@/lib/schedule";

const day = (id: string, index: number, rest = false) => ({ id, index, rest });

describe("weekOn", () => {
  test("the week a phase is in, null outside it", () => {
    const start = "2026-09-21T00:00:00Z";
    assert.equal(weekOn(start, 4, "2026-09-20"), null);
    assert.equal(weekOn(start, 4, "2026-09-21"), 1);
    assert.equal(weekOn(start, 4, "2026-09-28"), 2);
    assert.equal(weekOn(start, 4, "2026-10-18"), 4);
    assert.equal(weekOn(start, 4, "2026-10-19"), null);
  });
});

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

  test("the active program wins the shared date, however late it started", () => {
    const peak = { id: "peak", programId: "other", startDate: "2026-09-28T00:00:00Z", weeks: [{ order: 1, days: [day("p", 0)] }] };
    const s = sessionsOf([peak, { ...base, programId: "main" }], undefined, "main");
    assert.equal(sessionOn(s, "2026-09-28")?.day.id, "c");
  });

  test("only one program trains at a time: the other does nothing, even on the active one's rest days", () => {
    // "other" trains Tuesday 22nd, a rest day of "main"; it still runs after "main" ends.
    const other = { id: "o", programId: "other", startDate: "2026-09-22T00:00:00Z", weeks: [{ order: 1, days: [day("o1", 0), day("o2", 13)] }, { order: 2, days: [] }] };
    const s = sessionsOf([{ ...base, programId: "main" }, other], undefined, "main");
    assert.equal(sessionOn(s, "2026-09-22"), null);
    assert.equal(sessionOn(s, "2026-09-23")?.day.id, "b");
    assert.equal(sessionOn(s, "2026-10-05")?.day.id, "o2");
  });

  test("with none picked, the newer program owns the overlap, rest days included", () => {
    const newer = { id: "n", programId: "newer", startDate: "2026-09-22T00:00:00Z", weeks: [{ order: 1, days: [day("n1", 6)] }] };
    const s = sessionsOf([{ ...base, programId: "main" }, newer]);
    assert.equal(sessionOn(s, "2026-09-21")?.day.id, "a");
    assert.equal(sessionOn(s, "2026-09-23"), null);
    assert.equal(sessionOn(s, "2026-09-28")?.day.id, "n1");
    assert.equal(sessionOn(s, "2026-09-30")?.day.id, "d");
  });

  test("finds today, the next and the previous session", () => {
    const s = sessionsOf([base]);
    assert.equal(sessionOn(s, "2026-09-22"), null);
    assert.equal(nextSession(s, "2026-09-22")?.day.id, "b");
    assert.equal(previousSession(s, "2026-09-22")?.day.id, "a");
    assert.equal(nextSession(s, "2026-09-30"), null);
  });

  test("a moved session sits on its new date, and says where it came from", () => {
    const s = sessionsOf([base], new Map([["b", "2026-09-22"]]));
    assert.equal(sessionOn(s, "2026-09-23"), null);
    const moved = sessionOn(s, "2026-09-22");
    assert.equal(moved?.day.id, "b");
    assert.equal(moved?.movedFrom, "2026-09-23");
    assert.equal(moved?.week, 1);
    assert.equal(sessionOn(s, "2026-09-21")?.movedFrom, undefined);
  });

  test("a move to the planned date is no move", () => {
    const s = sessionsOf([base], new Map([["b", "2026-09-23"]]));
    assert.equal(sessionOn(s, "2026-09-23")?.movedFrom, undefined);
  });

  test("a moved session wins its new date over the plan", () => {
    const s = sessionsOf([base], new Map([["a", "2026-09-23"]]));
    assert.equal(sessionOn(s, "2026-09-23")?.day.id, "a");
    assert.equal(sessionOn(s, "2026-09-21"), null);
  });
});

test("addDays crosses months", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-10-01", -1), "2026-09-30");
});
