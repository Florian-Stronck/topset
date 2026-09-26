import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKind, monthGrid, parseMonth, shiftMonth } from "@/lib/calendar";

test("steps months across the year's end", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-09", 0), "2026-09");
});

test("only takes a real month", () => {
  assert.equal(parseMonth("2026-09"), "2026-09");
  assert.equal(parseMonth("2026-13"), null);
  assert.equal(parseMonth("2026-9"), null);
  assert.equal(parseMonth(undefined), null);
});

test("lays a month out in whole weeks from the first day of the week", () => {
  // September 2026 starts on a Tuesday and ends on a Wednesday.
  const monday = monthGrid("2026-09", 0);
  assert.equal(monday.length, 5);
  assert.equal(monday[0][0].ymd, "2026-08-31");
  assert.equal(monday[0][0].inMonth, false);
  assert.equal(monday[0][1].ymd, "2026-09-01");
  assert.equal(monday[4][6].ymd, "2026-10-04");
  assert.ok(monday.every((w) => w.length === 7));

  const sunday = monthGrid("2026-09", 6);
  assert.equal(sunday[0][0].ymd, "2026-08-30");
  // February 2027 starts on a Monday and has exactly four weeks.
  assert.equal(monthGrid("2027-02", 0).length, 4);
});

test("colours a day by the most telling thing that happened", () => {
  const session = (done: number, pr = false) => ({ done, prescribed: 6, pr });
  const today = "2026-09-26";
  assert.equal(dayKind("2026-09-20", today, { session: session(6, true), meet: true }), "meet");
  assert.equal(dayKind("2026-09-20", today, { session: session(6, true), meet: false }), "pr");
  assert.equal(dayKind("2026-09-20", today, { session: session(6), meet: false }), "done");
  assert.equal(dayKind("2026-09-20", today, { session: session(2), meet: false }), "done");
  assert.equal(dayKind("2026-09-20", today, { session: session(0), meet: false }), "missed");
  assert.equal(dayKind(today, today, { session: session(0), meet: false }), "plan");
  assert.equal(dayKind("2026-09-30", today, { session: session(0), meet: false }), "plan");
  assert.equal(dayKind("2026-09-30", today, { session: null, meet: false }), "none");
  assert.equal(dayKind("2026-10-03", today, { session: null, meet: true }), "meet");
});
