import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeJpeg, nutrientOf, parseConfig } from "@/lib/checkins";
import { averages, cleanAmount, hitTarget, isEmpty, nutritionId, targetOn, targetSpan, type NutritionEntry } from "@/lib/nutrition";
import { validMergedRow } from "@/lib/sync-plan";

test("a nutrient question keeps its target and unit, and a photo toggle survives any kind", () => {
  assert.deepEqual(parseConfig("NUMBER", '{"nutrient":"protein","unit":"lb"}'), { nutrient: "protein", unit: "g" });
  assert.deepEqual(parseConfig("NUMBER", { nutrient: "sugar" as never, unit: "g" }), { unit: "g" });
  assert.deepEqual(parseConfig("SCALE", '{"photo":true}'), { min: 1, max: 5, photo: true });
  assert.deepEqual(parseConfig("TEXT", { photo: true }), { photo: true });
  assert.equal(nutrientOf({ kind: "NUMBER", config: { nutrient: "kcal" } }), "kcal");
  assert.equal(nutrientOf({ kind: "TEXT", config: {} }), null);
});

test("amounts are whole numbers within reason", () => {
  assert.equal(cleanAmount("kcal", "2450,6"), 2451);
  assert.equal(cleanAmount("protein", ""), null);
  assert.equal(cleanAmount("protein", -5), null);
  assert.equal(cleanAmount("kcal", 99999), null);
});

test("7-day averages skip days a nutrient wasn't logged", () => {
  const e = (day: string, kcal: number | null, protein: number | null): NutritionEntry => ({
    id: nutritionId("a", day), day, kcal, protein, carbs: null, fat: null, source: "athlete",
  });
  const avg = averages([e("2026-09-19", 3000, null), e("2026-09-24", 2000, 150), e("2026-09-26", 2500, 170)], "2026-09-26");
  assert.deepEqual(avg, { kcal: 2250, protein: 160, carbs: null, fat: null });
  assert.equal(isEmpty(e("2026-09-26", null, null)), true);
});

test("a nutrition row sent up must sit under its own athlete and day", () => {
  const row = { id: nutritionId("a1", "2026-09-26"), athleteId: "a1", day: "2026-09-26", kcal: 2000, protein: null, carbs: null, fat: null };
  assert.equal(validMergedRow("NutritionLog", row), true);
  assert.equal(validMergedRow("NutritionLog", { ...row, athleteId: "a2" }), false);
});

test("only JPEG bytes pass as a photo", () => {
  assert.equal(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
});

test("the target on a day is the phase it falls in, the later one where phases overlap", () => {
  const t1 = { kcal: 2800, protein: 180, carbs: null, fat: null };
  const t2 = { kcal: 2400, protein: 200, carbs: null, fat: null };
  const a = targetSpan({ startDate: new Date("2026-09-07T00:00:00Z"), weeks: 4, kcalTarget: 2800, proteinTarget: 180, carbsTarget: null, fatTarget: null })!;
  const b = targetSpan({ startDate: new Date("2026-09-28T00:00:00Z"), weeks: 4, kcalTarget: 2400, proteinTarget: 200, carbsTarget: null, fatTarget: null })!;
  assert.deepEqual(a, { from: "2026-09-07", to: "2026-10-05", target: t1 });
  assert.deepEqual(targetOn([a, b], "2026-09-27"), t1);
  assert.deepEqual(targetOn([a, b], "2026-09-29"), t2);
  assert.equal(targetOn([a, b], "2026-10-26"), null);
  assert.equal(targetSpan({ startDate: new Date(), weeks: 4, kcalTarget: null, proteinTarget: null, carbsTarget: null, fatTarget: null }), null);
});

test("a day hits when calories land within 10% and protein reaches the target", () => {
  const target = { kcal: 2500, protein: 180, carbs: 300, fat: 70 };
  assert.equal(hitTarget({ kcal: 2700, protein: 185 }, target), true);
  assert.equal(hitTarget({ kcal: 2800, protein: 185 }, target), false);
  assert.equal(hitTarget({ kcal: 2500, protein: 170 }, target), false);
  assert.equal(hitTarget({ kcal: 2500, protein: null }, target), null);
  assert.equal(hitTarget({ kcal: 2000, protein: null }, { ...target, protein: null }), false);
  assert.equal(hitTarget({ kcal: 2500, protein: 200 }, { kcal: null, protein: null, carbs: 300, fat: 70 }), null);
});
