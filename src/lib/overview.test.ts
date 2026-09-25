import assert from "node:assert/strict";
import { test } from "node:test";
import { athleteTraining, phaseSpan, trainingFlags, type WindowSession } from "@/lib/overview";
import type { ComplianceRow } from "@/lib/compliance";

const row = (over: Partial<ComplianceRow> = {}): ComplianceRow => ({
  exercise: "Squat",
  sets: 3,
  intensityType: "RPE",
  intensity: 8,
  intensityMax: null,
  actualWeight: null,
  performedRpe: null,
  logs: [],
  ...over,
});

const session = (ymd: string, rows: ComplianceRow[]): WindowSession => ({ ymd, label: "Day", rows });
const week = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
const today = "2026-09-24";
const phase = [phaseSpan({ startDate: "2026-09-07T00:00:00Z", weeks: 4 })];

test("the week's cells, and completion over what was due", () => {
  const training = athleteTraining(
    [
      session("2026-09-21", [row({ actualWeight: 100 })]),
      session("2026-09-22", [row({ logs: [{ done: true }] })]),
      session("2026-09-23", [row()]),
      session("2026-09-24", [row()]),
      session("2026-09-26", [row()]),
    ],
    phase,
    week,
    today,
  );
  assert.deepEqual(
    training.cells.map((c) => c.status),
    ["done", "partial", "missed", "today", "rest", "upcoming", "rest"],
  );
  // Today's untouched session isn't due yet: 4 of 9 sets.
  assert.equal(training.weekPct, 44);
  assert.equal(training.missed7, 1);
  assert.equal(training.lastDone, "2026-09-22");
});

test("a day past every phase has nothing planned", () => {
  const training = athleteTraining([], [{ start: "2026-09-01", end: "2026-09-22" }], week, today);
  assert.deepEqual(training.cells.slice(0, 2).map((c) => c.status), ["rest", "none"]);
  assert.equal(training.weekPct, null);
});

const noBodyweight = { latest: null, age: null, avg7: null, change7: null };

test("flags: silence, missed sessions, RPE drift, weight class", () => {
  const quiet = athleteTraining([session("2026-09-15", [row()]), session("2026-09-22", [row()])], phase, week, today);
  assert.deepEqual(
    trainingFlags(quiet, { hasLink: false, linksOn: true, bodyweight: noBodyweight, meet: null, unit: "kg" }).map((f) => f.action),
    ["link"],
  );

  const heavy = athleteTraining(
    [
      session("2026-09-14", [row({ actualWeight: 100, performedRpe: 9 })]),
      session("2026-09-16", [row({ actualWeight: 100, performedRpe: 9.5 })]),
      session("2026-09-18", [row({ actualWeight: 100, performedRpe: 9 })]),
      session("2026-09-21", [row()]),
      session("2026-09-23", [row()]),
    ],
    phase,
    week,
    today,
  );
  const flags = trainingFlags(heavy, {
    hasLink: true,
    linksOn: true,
    bodyweight: { ...noBodyweight, avg7: 84.6 },
    meet: { name: "Nationals", days: 30, weightClass: "83", limit: 83 },
    unit: "kg",
  });
  assert.equal(flags.length, 3);
  assert.match(flags[0].text, /Missed 2 sessions/);
  assert.match(flags[1].text, /\+1\.2 above plan/);
  assert.match(flags[2].text, /1\.6 kg over the 83 class, 30 days out/);
});

test("a training day with nothing written on it is not missed", () => {
  const training = athleteTraining([session("2026-09-21", [row({ exercise: "" })])], phase, week, today);
  assert.equal(training.cells[0].status, "rest");
  assert.equal(training.due14, 0);
});

test("low readiness in the last week is flagged, with the answers behind it", () => {
  const training = athleteTraining([], phase, week, today);
  const flags = trainingFlags(training, {
    hasLink: true,
    linksOn: true,
    bodyweight: noBodyweight,
    meet: null,
    unit: "kg",
    today,
    readiness: {
      day: "2026-09-23",
      score: 2.3,
      low: [
        { label: "Sleep", value: "1/5" },
        { label: "Soreness", value: "2/5" },
      ],
      notes: ["bad night"],
    },
  });
  assert.equal(flags.length, 1);
  assert.match(flags[0].text, /Readiness 2.3\/5 .* — sleep 1\/5, soreness 2\/5 · “bad night”/);

  const old = trainingFlags(training, {
    hasLink: true, linksOn: true, bodyweight: noBodyweight, meet: null, unit: "kg", today,
    readiness: { day: "2026-09-10", score: 1, low: [], notes: [] },
  });
  assert.equal(old.length, 0);
});
