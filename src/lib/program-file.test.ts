import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseProgramFile, toProgramFile, type ProgramRow } from "@/lib/program-file";

const row = (order: number, exercise: string, sets: number | null, rules: ProgramRow["rules"] = []): ProgramRow => ({
  order,
  tier: "PRIMARY",
  target: "Squat",
  exercise,
  sets,
  reps: 5,
  intensityType: "RPE",
  intensity: 8,
  intensityMax: null,
  rampStep: null,
  coachNotes: null,
  tempo: null,
  restTime: null,
  videoUrl: null,
  rules,
});

const rule = {
  order: 0,
  field: "SETS" as const,
  op: "ADD" as const,
  amount: 1,
  everyWeeks: 1,
  startWeek: 1,
  endWeek: null,
  enabled: true,
};

const program = {
  name: "Meet prep",
  phases: [
    {
      phase: "Base",
      startDate: new Date("2026-09-07T00:00:00Z"),
      squat1RM: 200,
      bench1RM: null,
      dead1RM: 240,
      weeks: [
        {
          order: 1,
          locked: false,
          days: [{ index: 0, label: "Day 1", rest: false, rows: [row(0, "Squat", 3, [rule]), row(1, "Leg press", 3)] }],
        },
        {
          order: 2,
          locked: false,
          days: [{ index: 0, label: "Day 1", rest: false, rows: [row(0, "Squat", 4), row(1, "Leg press", 3)] }],
        },
        {
          // A deload with its own shape: fewer rows, a different day name, an extra day.
          order: 3,
          locked: true,
          days: [
            { index: 0, label: "Deload", rest: false, rows: [row(0, "Pause squat", 2)] },
            { index: 2, label: "Mobility", rest: false, rows: [row(0, "Hip flow", null)] },
          ],
        },
      ],
    },
  ],
};

describe("program file", () => {
  test("a locked week travels whole and stays locked", () => {
    const file = parseProgramFile(JSON.stringify(toProgramFile(program)));
    const [phase] = file.phases;

    assert.deepEqual(phase.weeks.map((w) => w.locked), [false, false, true]);
    const deload = phase.weeks[2];
    assert.deepEqual(deload.days.map((d) => d.label), ["Deload", "Mobility"]);
    assert.deepEqual(deload.days[0].rows.map((r) => [r.exercise, r.sets]), [["Pause squat", 2]]);
    assert.equal(phase.weeks[1].days[0].rows[0].sets, 4);
  });

  test("round trip loses nothing", () => {
    const once = toProgramFile(program);
    assert.deepEqual(parseProgramFile(JSON.stringify(once)), once);
  });

  test("rules stay on the row they were written on", () => {
    const [phase] = parseProgramFile(JSON.stringify(toProgramFile(program))).phases;
    assert.equal(phase.weeks[0].days[0].rows[0].rules.length, 1);
    assert.equal(phase.weeks[1].days[0].rows[0].rules.length, 0);
  });

  test("a version 2 file still reads, a week per cell", () => {
    const v2 = {
      topset: 2,
      name: "Old",
      phases: [
        {
          phase: "Base",
          startDate: "2026-01-05",
          weeks: 2,
          squat1RM: null,
          bench1RM: null,
          dead1RM: null,
          days: [
            {
              index: 0,
              label: "Day 1",
              rest: false,
              rows: [
                {
                  order: 0,
                  tier: "PRIMARY",
                  target: "Squat",
                  exercise: "Squat",
                  rules: [rule],
                  cells: [
                    { week: 1, sets: 3, reps: 5, intensityType: "RPE", intensity: 7 },
                    { week: 2, sets: 4, reps: 5, intensityType: "RPE", intensity: 8 },
                    { week: 9, sets: 9, reps: 9, intensityType: "RPE", intensity: 9 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const [phase] = parseProgramFile(JSON.stringify(v2)).phases;
    assert.equal(phase.weeks.length, 2);
    assert.deepEqual(phase.weeks.map((w) => w.locked), [false, false]);
    assert.deepEqual(phase.weeks.map((w) => w.days[0].rows[0].sets), [3, 4]);
    assert.equal(phase.weeks[0].days[0].rows[0].rules.length, 1);
    assert.equal(phase.weeks[1].days[0].rows[0].rules.length, 0);
  });

  test("weeks are renumbered and duplicate slots settled", () => {
    const file = toProgramFile(program);
    const weeks = file.phases[0].weeks;
    weeks[1].week = 1;
    weeks[2].week = 9;
    weeks[2].days.push({ ...weeks[2].days[0], label: "Duplicate" });
    const [phase] = parseProgramFile(JSON.stringify(file)).phases;
    assert.deepEqual(phase.weeks.map((w) => w.week), [1, 2, 3]);
    assert.deepEqual(phase.weeks[2].days.map((d) => d.index), [0, 2]);
  });

  test("a phase with no weeks is refused", () => {
    const file = toProgramFile(program);
    file.phases[0].weeks = [];
    assert.throws(() => parseProgramFile(JSON.stringify(file)), /no weeks/);
  });
});
