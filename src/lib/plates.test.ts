import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBar, PLATE_SETS } from "@/lib/plates";

test("loads a round kg number heaviest first", () => {
  const r = loadBar(182.5, { bar: 20, collars: 2.5, plates: PLATE_SETS.KG.plates });
  assert.deepEqual(r.perSide, [25, 25, 25, 5]);
  assert.equal(r.total, 182.5);
  assert.equal(r.short, 0);
});

test("uses change plates without float drift", () => {
  const r = loadBar(23.5, { bar: 20, plates: PLATE_SETS.KG.plates });
  assert.deepEqual(r.perSide, [1.25, 0.5]);
  assert.equal(r.total, 23.5);
});

test("says how much it could not make up", () => {
  const r = loadBar(101, { bar: 20, plates: [25, 20, 15, 10, 5, 2.5] });
  assert.equal(r.total, 100);
  assert.equal(r.short, 1);
});

test("a target under the bar loads nothing", () => {
  const r = loadBar(15, { bar: 20, plates: PLATE_SETS.KG.plates });
  assert.deepEqual(r.perSide, []);
  assert.equal(r.total, 20);
});

test("lb set", () => {
  assert.deepEqual(loadBar(315, PLATE_SETS.LB).perSide, [45, 45, 45]);
});
