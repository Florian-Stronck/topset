import assert from "node:assert/strict";
import { test } from "node:test";
import { byUrgency, isSnoozed, liveSnoozes, setText, type InboxItem } from "@/lib/inbox";
import { estimate1RM } from "@/lib/intensity";
import type { TrainingSession } from "@/lib/overview";
import { liftTrends, suggestionsFor, weeklyDone, weeklyDrift, weeklyReadiness, weekStarts, type RosterRow } from "@/lib/roster";

type Row = TrainingSession["rows"][number];

const log = (weight: number, reps: number, rpe: number, done = true) => ({
  id: `${weight}-${reps}-${rpe}`,
  setIndex: 0,
  weight,
  reps,
  rpe,
  rir: null,
  done,
  pr: false,
  loggedAt: "2026-10-01T10:00:00.000Z",
});

const row = (over: Partial<Row> = {}): Row => ({
  id: "r",
  tier: "PRIMARY",
  target: "Squat",
  exercise: "Squat",
  sets: 3,
  reps: 3,
  repsMax: null,
  intensityType: "RPE",
  intensity: 8,
  intensityMax: null,
  load: null,
  actualWeight: null,
  performedRpe: null,
  athleteNotes: null,
  logs: [],
  ...over,
});

const session = (ymd: string, rows: Row[]) => ({ ymd, rows });

test("weeks run oldest first, this one last", () => {
  assert.deepEqual(weekStarts("2026-10-26", 3), ["2026-10-12", "2026-10-19", "2026-10-26"]);
});

test("sets done per week count what was due, and nothing due is null", () => {
  const weeks = ["2026-10-12", "2026-10-19", "2026-10-26"];
  const done = weeklyDone(
    [
      session("2026-10-13", [row({ logs: [log(100, 3, 8), log(100, 3, 8), log(100, 3, 8)] })]),
      session("2026-10-15", [row()]),
      // Today, untouched: not due yet.
      session("2026-10-28", [row()]),
    ],
    weeks,
    "2026-10-28",
  );
  assert.deepEqual(done, [50, null, null]);
});

test("RPE drift and readiness average per week", () => {
  const weeks = ["2026-10-19", "2026-10-26"];
  assert.deepEqual(weeklyDrift([session("2026-10-27", [row({ performedRpe: 9 })])], weeks), [null, 1]);
  assert.deepEqual(
    weeklyReadiness(
      [
        { day: "2026-10-20", score: 4 },
        { day: "2026-10-21", score: 3 },
        { day: "2026-10-27", score: null },
      ],
      weeks,
    ),
    [3.5, null],
  );
});

test("e1RM trend: best of the last four weeks against the four before", () => {
  const today = "2026-10-28";
  const trends = liftTrends(
    [
      session("2026-09-20", [row({ logs: [log(150, 3, 8)] })]),
      session("2026-10-20", [row({ logs: [log(160, 3, 8)] }), row({ target: "Bench", logs: [log(100, 3, 8)] })]),
      // An accessory never counts, nor a set not done.
      session("2026-10-21", [row({ tier: "ACCESSORY", logs: [log(200, 3, 8)] }), row({ logs: [log(180, 3, 8, false)] })]),
    ],
    today,
    "KG",
  );
  const recent = estimate1RM(160, 3, 8, "KG")!;
  const prior = estimate1RM(150, 3, 8, "KG")!;
  assert.equal(trends.squat.e1rm, recent);
  assert.equal(trends.squat.change, Math.round((recent / prior - 1) * 1000) / 10);
  assert.equal(trends.bench.change, null);
  assert.equal(trends.dead.e1rm, null);
});

const roster = (over: Partial<RosterRow> = {}): RosterRow => ({
  id: "a",
  name: "Tom",
  unit: "kg",
  href: "",
  programHref: "",
  phase: null,
  daysLeft: null,
  training: false,
  lastLog: null,
  done: [],
  weekPct: null,
  rpe: [0, 0],
  readiness: [4, 4],
  phaseId: null,
  lifts: {
    squat: { e1rm: 180, change: 2, onFile: 180, onPhase: false },
    bench: { e1rm: 120, change: 1.5, onFile: 120, onPhase: false },
    dead: { e1rm: 220, change: 1, onFile: 220, onPhase: false },
  },
  bodyweight: null,
  meet: null,
  ...over,
});

const say = {
  rundown: () => ({ title: "rundown", why: "" }),
  raise: () => ({ title: "raise", why: "" }),
  stall: () => ({ title: "stall", why: "" }),
  push: () => ({ title: "push", why: "" }),
};

test("suggestions: run down, a max to raise, a stall, room to push", () => {
  assert.deepEqual(suggestionsFor(roster(), say), []);
  assert.deepEqual(suggestionsFor(roster({ readiness: [4, 3.4, 2.9], rpe: [0.2, 0.6] }), say).map((s) => s.title), ["rundown"]);
  const raise = suggestionsFor(roster({ lifts: { ...roster().lifts, squat: { e1rm: 190, change: 3, onFile: 180, onPhase: false } } }), say);
  assert.deepEqual(raise.map((s) => [s.title, s.max]), [["raise", { lift: "squat", value: 190 }]]);
  const stall = suggestionsFor(roster({ lifts: { ...roster().lifts, bench: { e1rm: 120, change: 0, onFile: 120, onPhase: false } } }), say);
  assert.deepEqual(stall.map((s) => s.title), ["stall"]);
  assert.deepEqual(suggestionsFor(roster({ rpe: [-0.6, -0.8] }), say).map((s) => s.title), ["push"]);
});

const item = (over: Partial<InboxItem>): InboxItem => ({
  key: "k",
  athleteId: "a",
  athlete: "Ana",
  kind: "session",
  text: "",
  urgent: false,
  at: null,
  href: "",
  hrefLabel: "",
  ...over,
});

test("inbox: urgent first, PRs last, newest first in between", () => {
  const list = [
    item({ key: "pr", kind: "pr", at: "2026-10-28T09:00:00Z" }),
    item({ key: "old", at: "2026-10-26T09:00:00Z" }),
    item({ key: "urgent", kind: "program", urgent: true }),
    item({ key: "new", at: "2026-10-28T08:00:00Z" }),
  ].sort(byUrgency);
  assert.deepEqual(list.map((i) => i.key), ["urgent", "new", "old", "pr"]);
});

test("inbox: a snooze hides until its day, then is dropped", () => {
  const snoozes = { a: "2026-10-29", b: "2026-10-28" };
  assert.equal(isSnoozed(snoozes, "a", "2026-10-28"), true);
  assert.equal(isSnoozed(snoozes, "b", "2026-10-28"), false);
  assert.equal(isSnoozed(snoozes, "c", "2026-10-28"), false);
  assert.deepEqual(liveSnoozes(snoozes, "2026-10-28"), { a: "2026-10-29" });
});

test("a logged set reads weight × reps and its effort", () => {
  assert.equal(setText({ weight: 160, reps: 3, rpe: 8.5, rir: null }), "160×3 @8.5");
  assert.equal(setText({ weight: 100, reps: 8, rpe: null, rir: 2 }), "100×8 RIR 2");
  assert.equal(setText({ weight: null, reps: null, rpe: null, rir: null, seconds: 45 }), "45s");
});
