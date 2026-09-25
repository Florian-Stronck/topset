import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeGap, formatDate, mondayOf, phaseGaps, snapStart, weekdayOf, weekStartOf } from "@/lib/dates";
import { DEFAULTS, setActiveSettings } from "@/lib/settings";

describe("mondayOf", () => {
  test("a Monday stays put", () => {
    assert.equal(mondayOf("2026-09-21"), "2026-09-21");
  });

  test("midweek and Sunday go back to that week's Monday", () => {
    assert.equal(mondayOf("2026-09-23"), "2026-09-21");
    assert.equal(mondayOf("2026-09-27"), "2026-09-21");
  });

  test("crosses month and year boundaries", () => {
    assert.equal(mondayOf("2026-10-01"), "2026-09-28");
    assert.equal(mondayOf("2027-01-01"), "2026-12-28");
  });

  test("ignores a time part", () => {
    assert.equal(mondayOf("2026-09-24T15:00:00.000Z"), "2026-09-21");
  });

  test("leaves garbage alone", () => {
    assert.equal(mondayOf("not a date"), "not a date");
  });
});

describe("phaseGaps", () => {
  const phase = (id: string, start: string, weeks: number) => ({
    id,
    startDate: new Date(`${start}T00:00:00Z`),
    weeks: Array.from({ length: weeks }),
  });

  test("back-to-back phases have no gap", () => {
    const gaps = phaseGaps([phase("a", "2026-09-21", 4), phase("b", "2026-10-19", 4)]);
    assert.equal(gaps.size, 0);
  });

  test("a break is positive, keyed by the later phase", () => {
    const gaps = phaseGaps([phase("a", "2026-09-21", 4), phase("b", "2026-11-02", 4)]);
    assert.deepEqual([...gaps], [["b", 14]]);
  });

  test("an overlap is negative", () => {
    const gaps = phaseGaps([phase("a", "2026-09-21", 4), phase("b", "2026-10-12", 4)]);
    assert.deepEqual([...gaps], [["b", -7]]);
  });

  test("survives a DST change", () => {
    const gaps = phaseGaps([
      { id: "a", startDate: new Date(2026, 9, 19), weeks: Array.from({ length: 2 }) },
      { id: "b", startDate: new Date(2026, 10, 2), weeks: [] },
    ]);
    assert.equal(gaps.size, 0);
  });
});

describe("describeGap", () => {
  test("whole weeks in weeks, the rest in days", () => {
    assert.equal(describeGap(14), "2 wk break");
    assert.equal(describeGap(-7), "1 wk overlap");
    assert.equal(describeGap(3), "3 day break");
    assert.equal(describeGap(-1), "1 day overlap");
  });
});

describe("weekStartOf", () => {
  test("any first day of the week", () => {
    assert.equal(weekStartOf("2026-09-23", 0), "2026-09-21"); // Monday
    assert.equal(weekStartOf("2026-09-23", 6), "2026-09-20"); // Sunday
    assert.equal(weekStartOf("2026-09-26", 5), "2026-09-26"); // a Saturday start
  });
});

describe("snapStart", () => {
  test("follows the coach's week start, or leaves the date alone", () => {
    setActiveSettings({ ...DEFAULTS, weekStart: 6 });
    assert.equal(snapStart("2026-09-23"), "2026-09-20");
    setActiveSettings({ ...DEFAULTS, snapStart: false });
    assert.equal(snapStart("2026-09-23"), "2026-09-23");
    setActiveSettings(DEFAULTS);
  });
});

describe("weekdayOf and formatDate", () => {
  test("read UTC-midnight and local-midnight dates as the same day", () => {
    // Monday 21 Sept, stored both ways.
    assert.equal(weekdayOf("2026-09-21T00:00:00.000Z"), 0);
    assert.equal(weekdayOf("2026-09-20T22:00:00.000Z"), 0);
    assert.equal(formatDate("2026-09-20T22:00:00.000Z"), "21 Sept");
  });

  test("the coach's date format", () => {
    setActiveSettings({ ...DEFAULTS, dateFormat: "dd/mm" });
    assert.equal(formatDate("2026-09-21T00:00:00.000Z", true), "21/09/2026");
    setActiveSettings({ ...DEFAULTS, dateFormat: "mm/dd" });
    assert.equal(formatDate("2026-09-21T00:00:00.000Z"), "09/21");
    setActiveSettings(DEFAULTS);
  });
});
