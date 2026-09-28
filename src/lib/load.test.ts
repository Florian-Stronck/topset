import assert from "node:assert/strict";
import test from "node:test";
import { acwr, acwrZone, dailyLoad, rowLoad, weekLoad, type TimedRow } from "@/lib/load";
import { addDays } from "@/lib/schedule";

const row = (over: Partial<TimedRow> = {}): TimedRow => ({
  ymd: "2026-09-28",
  sets: 5,
  duration: 300,
  intensityType: "RPE",
  intensity: 8,
  logs: [],
  ...over,
});

test("planned load is rounds × minutes × RPE; done counts each round as it went", () => {
  assert.equal(rowLoad(row()).planned, 200);
  const logs = [
    { seconds: 300, rpe: 9, rir: null, done: true },
    { seconds: null, rpe: null, rir: null, done: true },
    { seconds: 120, rpe: null, rir: 2, done: true },
    { seconds: 300, rpe: 10, rir: null, done: false },
  ];
  const l = rowLoad(row({ logs }));
  // 5 min @9, 5 min at the written 8, 2 min @8 (RIR 2).
  assert.equal(l.done, 45 + 40 + 16);
  assert.equal(l.minutes, 12);
  // A weight says nothing about effort.
  assert.equal(rowLoad(row({ intensityType: "WEIGHT", intensity: 20 })).planned, 0);
  assert.equal(rowLoad(row({ intensityType: "RIR", intensity: 3 })).planned, 175);
  // A fighter's "spar at 70%" is an RPE of 7.
  assert.equal(rowLoad(row({ intensityType: "PERCENT", intensity: 70 })).planned, 175);
});

test("days add their rows up; weeks get monotony and strain", () => {
  const done = (ymd: string, rpe: number) => row({ ymd, sets: 1, duration: 600, logs: [{ seconds: 600, rpe, rir: null, done: true }] });
  const daily = dailyLoad([done("2026-09-28", 6), done("2026-09-28", 6), done("2026-09-30", 6)]);
  assert.equal(daily.get("2026-09-28")?.done, 120);
  const week = weekLoad(daily, "2026-09-28");
  assert.equal(week.done, 180);
  assert.equal(week.minutes, 30);
  assert.ok(week.monotony !== null && week.monotony > 0);
  assert.equal(weekLoad(new Map(), "2026-09-28").monotony, null);
});

test("ACWR waits for four weeks, then compares the last one with the average", () => {
  const today = "2026-09-28";
  const steady = new Map<string, { planned: number; done: number; minutes: number }>();
  for (let i = 0; i < 28; i++) steady.set(addDays(today, -i), { planned: 0, done: 100, minutes: 10 });
  assert.equal(acwr(steady, today), 1);

  const spike = new Map(steady);
  for (let i = 0; i < 7; i++) spike.set(addDays(today, -i), { planned: 0, done: 300, minutes: 30 });
  assert.equal(acwr(spike, today), 2);
  assert.equal(acwrZone(2), "spike");
  assert.equal(acwrZone(1), "ok");

  const young = new Map([[today, { planned: 0, done: 100, minutes: 10 }]]);
  assert.equal(acwr(young, today), null);
});
