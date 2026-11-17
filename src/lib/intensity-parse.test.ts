import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIntensity } from "@/lib/intensity";

test("reads intensity the way a sheet's cell holds it", () => {
  assert.deepEqual(parseIntensity("80%", "RPE"), { intensity: 80, intensityType: "PERCENT" });
  assert.deepEqual(parseIntensity("@7,5", "PERCENT"), { intensity: 7.5, intensityType: "RPE" });
  assert.deepEqual(parseIntensity("RPE 8", "PERCENT"), { intensity: 8, intensityType: "RPE" });
  assert.deepEqual(parseIntensity("2 rir", "RPE"), { intensity: 2, intensityType: "RIR" });
  assert.deepEqual(parseIntensity("100-110 kg", "RPE"), { intensity: 100, intensityMax: 110, intensityType: "RANGE" });
  assert.deepEqual(parseIntensity("-10%", "RPE"), { intensity: 10, intensityType: "BACKOFF" });
  assert.deepEqual(parseIntensity("78 + 2.5", "PERCENT"), { rampStep: 2.5, intensity: 78 });
  assert.deepEqual(parseIntensity("", "RPE"), { intensity: null });
});

test("turns away what no intensity is", () => {
  assert.equal(parseIntensity("78", "RPE"), null);
  assert.equal(parseIntensity("@11", "PERCENT"), null);
  assert.equal(parseIntensity("heavy", "PERCENT"), null);
  assert.deepEqual(parseIntensity("78", "PERCENT"), { intensity: 78 });
});
