import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckinQuestionData } from "@/lib/checkins";
import type { ExerciseHistory } from "@/lib/exercise-history";
import {
  attentionOf,
  keepRow,
  keepSession,
  latestOf,
  needsReview,
  previousLogs,
  readinessSeries,
  tierGroup,
  topSetOf,
  type SessionFacts,
} from "@/lib/tracking";
import type { BlockData, RowData } from "@/lib/types";
import type { SetLogData } from "@/lib/setlog";

const log = (setIndex: number, weight: number, reps: number, over: Partial<SetLogData> = {}): SetLogData => ({
  id: `l${setIndex}`,
  setIndex,
  weight,
  reps,
  rpe: 8,
  rir: null,
  done: true,
  pr: false,
  loggedAt: "2026-09-21T18:00:00.000Z",
  ...over,
});

const row = (over: Partial<RowData> = {}): RowData => ({
  id: "r1",
  order: 0,
  rules: [],
  tier: "PRIMARY",
  target: "Squat",
  exercise: "Back Squat",
  fromId: null,
  sets: 3,
  reps: 5,
  intensityType: "RPE",
  intensity: 8,
  intensityMax: null,
  rampStep: null,
  coachNotes: null,
  tempo: null,
  restTime: null,
  videoUrl: null,
  actualWeight: null,
  performedRpe: null,
  athleteNotes: null,
  ...over,
});

test("the top set is the heaviest one finished, ties going to the harder one", () => {
  const top = topSetOf(row({ logs: [log(0, 170, 5), log(1, 180, 4, { rpe: 8.5 }), log(2, 180, 4, { rpe: 9 }), log(3, 200, 1, { done: false })] }));
  assert.deepEqual(top, { weight: 180, reps: 4, rpe: 9 });
});

test("an RIR counts as its RPE, and a typed-in weight stands in when no sets were logged", () => {
  assert.deepEqual(topSetOf(row({ logs: [log(0, 150, 5, { rpe: null, rir: 2 })] })), { weight: 150, reps: 5, rpe: 8 });
  assert.deepEqual(topSetOf(row({ actualWeight: 160, performedRpe: 7 })), { weight: 160, reps: 5, rpe: 7 });
  assert.equal(topSetOf(row()), null);
});

test("previous logs find the last earlier session of the same exercise, whatever its spelling", () => {
  const block: Pick<BlockData, "startDate" | "weeks"> = {
    startDate: "2026-09-14T00:00:00.000Z",
    weeks: [
      { id: "w1", order: 1, locked: false, days: [{ id: "d1", index: 0, label: "A", rest: false, rows: [row({ id: "a" })] }] },
      { id: "w2", order: 2, locked: false, days: [{ id: "d2", index: 0, label: "A", rest: false, rows: [row({ id: "b" }), row({ id: "c", exercise: "Leg press" })] }] },
    ],
  };
  const history: ExerciseHistory[] = [
    {
      name: "back  squat",
      logs: [
        { ymd: "2026-09-07", where: "", week: 1, prescribed: "", target: null, weight: 160, reps: 5, rpe: 8, e1rm: 195 },
        { ymd: "2026-09-14", where: "", week: 1, prescribed: "", target: null, weight: 170, reps: 5, rpe: 8, e1rm: 207.5 },
        { ymd: "2026-09-21", where: "", week: 2, prescribed: "", target: null, weight: 175, reps: 5, rpe: 8, e1rm: 212.5 },
      ],
    },
  ];
  const prev = previousLogs(block, history);
  assert.equal(prev.a.weight, 160);
  assert.equal(prev.b.weight, 170);
  assert.equal(prev.c, undefined);
});

test("a session needs review once something came in after the coach last looked", () => {
  assert.equal(needsReview(false, null, null), false);
  assert.equal(needsReview(true, "2026-09-21T18:00:00.000Z", null), true);
  assert.equal(needsReview(true, "2026-09-21T18:00:00.000Z", "2026-09-21T19:00:00.000Z"), false);
  assert.equal(needsReview(true, "2026-09-21T20:00:00.000Z", "2026-09-21T19:00:00.000Z"), true);
  assert.equal(latestOf([null, "2026-09-21T18:00:00.000Z", undefined, "2026-09-22T06:00:00.000Z"]), "2026-09-22T06:00:00.000Z");
  assert.equal(latestOf([]), null);
});

test("filters: tiers group into main lifts, variations and accessories", () => {
  assert.equal(tierGroup("PRIMARY"), "main");
  assert.equal(tierGroup("BACKOFF"), "main");
  assert.equal(tierGroup("VARIATION"), "variations");
  assert.equal(tierGroup("ACCESSORY"), "accessories");

  const missed = { tier: "PRIMARY" as const, off: { level: "miss" as const, reasons: ["missed" as const] }, pr: false };
  const heavy = { tier: "ACCESSORY" as const, off: { level: "warn" as const, reasons: ["rpe" as const] }, pr: false };
  const pr = { tier: "PRIMARY" as const, off: null, pr: true };
  assert.equal(keepRow(missed, "missed", "all"), true);
  assert.equal(keepRow(heavy, "missed", "all"), false);
  assert.equal(keepRow(heavy, "offplan", "all"), true);
  assert.equal(keepRow(heavy, "offplan", "main"), false);
  assert.equal(keepRow(pr, "prs", "main"), true);
  assert.equal(keepRow(pr, "offplan", "all"), false);
});

test("sessions: upcoming ones can be hidden, and 'unreviewed' keeps only those", () => {
  const s = (over: Partial<SessionFacts>): SessionFacts => ({ status: "done", unreviewed: false, kept: 3, readiness: null, ...over });
  assert.equal(keepSession(s({ status: "upcoming" }), "all", false), false);
  assert.equal(keepSession(s({ status: "today" }), "all", false), true);
  assert.equal(keepSession(s({ status: "upcoming" }), "all", true), true);
  assert.equal(keepSession(s({ unreviewed: false }), "unreviewed", true), false);
  assert.equal(keepSession(s({ unreviewed: true }), "unreviewed", true), true);
  assert.equal(keepSession(s({ kept: 0 }), "all", true), false);
});

test("the attention bar counts sessions and rows, missed rows apart from off-plan ones", () => {
  const counts = attentionOf([
    {
      facts: { status: "missed", unreviewed: false, kept: 2, readiness: 2 },
      rows: [
        { tier: "PRIMARY", off: { level: "miss", reasons: ["missed"] }, pr: false },
        { tier: "ACCESSORY", off: { level: "miss", reasons: ["missed"] }, pr: false },
      ],
    },
    {
      facts: { status: "done", unreviewed: true, kept: 2, readiness: 4 },
      rows: [
        { tier: "PRIMARY", off: null, pr: true },
        { tier: "SECONDARY", off: { level: "warn", reasons: ["under"] }, pr: false },
      ],
    },
  ]);
  assert.deepEqual(counts, { unreviewed: 1, missed: 1, offPlan: 1, prs: 1, lowReadiness: 1 });
});

test("the readiness series has every day in range, gaps as nulls, and each scale question apart", () => {
  const questions = [
    { id: "s", label: "Sleep", kind: "SCALE", config: { min: 1, max: 5 }, cadence: "DAILY", days: [], icon: "bed", color: "blue", archived: false, order: 0 },
    { id: "n", label: "Note", kind: "TEXT", config: {}, cadence: "DAILY", days: [], icon: "note", color: "purple", archived: false, order: 1 },
  ] as unknown as CheckinQuestionData[];
  const answers = [
    { id: "1", questionId: "s", day: "2026-09-21", value: "2" },
    { id: "2", questionId: "n", day: "2026-09-21", value: "tired" },
    { id: "3", questionId: "s", day: "2026-09-23", value: "4" },
  ];
  const series = readinessSeries(questions, answers, "2026-09-21", "2026-09-23");
  assert.deepEqual(series.map((p) => p.day), ["2026-09-21", "2026-09-22", "2026-09-23"]);
  assert.deepEqual(series.map((p) => p.score), [2, null, 4]);
  assert.deepEqual(series[0].byQuestion, { s: 2 });
});
