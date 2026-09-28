import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, parseDuration, rowMinutes, volumeText } from "@/lib/duration";

test("durations read the way coaches write them", () => {
  assert.equal(parseDuration("5:00"), 300);
  assert.equal(parseDuration("0:30"), 30);
  assert.equal(parseDuration("1:05:00"), 3900);
  assert.equal(parseDuration("90s"), 90);
  assert.equal(parseDuration("3'"), 180);
  assert.equal(parseDuration("2 min"), 120);
  assert.equal(parseDuration("1,5m"), 90);
  // Small bare numbers are minutes, big ones seconds.
  assert.equal(parseDuration("5"), 300);
  assert.equal(parseDuration("45"), 45);
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration("abc"), null);
  assert.equal(parseDuration("0"), null);
});

test("durations print as a clock", () => {
  assert.equal(formatDuration(300), "5:00");
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(3900), "1:05:00");
  assert.equal(formatDuration(null), "");
  assert.equal(parseDuration(formatDuration(185)), 185);
});

test("a timed row's minutes are rounds times length", () => {
  assert.equal(rowMinutes({ sets: 5, duration: 300 }), 25);
  assert.equal(rowMinutes({ sets: null, duration: 60 }), 1);
  assert.equal(rowMinutes({ sets: 5, duration: null }), null);
});

test("volume reads as sets of reps, of time, or both", () => {
  assert.equal(volumeText({ sets: 5, reps: 5 }), "5 × 5");
  assert.equal(volumeText({ sets: 5, reps: null, duration: 180 }), "5 × 3:00");
  assert.equal(volumeText({ sets: 3, reps: 10, duration: 40 }), "3 × 10 / 0:40");
  assert.equal(volumeText({ sets: 3, reps: 8, repsMax: 10 }), "3 × 8–10");
});
