import assert from "node:assert/strict";
import test from "node:test";
import { areasIn, cleanInjury, injuryLabel, isActive, regionMarks, sortInjuries, type InjuryData } from "@/lib/injuries";

const base = { area: "knee", side: "L" as const, day: "2026-09-20", endDay: null, severity: 3, note: null };

test("an injury is active from its start until the day it cleared up", () => {
  assert.equal(isActive(base, "2026-09-28"), true);
  assert.equal(isActive(base, "2026-09-19"), false);
  assert.equal(isActive({ ...base, endDay: "2026-09-25" }, "2026-09-24"), true);
  assert.equal(isActive({ ...base, endDay: "2026-09-25" }, "2026-09-25"), false);
});

test("labels name the side", () => {
  assert.equal(injuryLabel(base), "Knee (left)");
  assert.equal(injuryLabel({ area: "low-back", side: null }), "Lower back");
});

test("input is checked before it's kept", () => {
  assert.deepEqual(cleanInjury({ ...base, note: "  twisted it  " }), { ...base, note: "twisted it" });
  assert.throws(() => cleanInjury({ ...base, area: "tail" }), /where/);
  assert.throws(() => cleanInjury({ ...base, side: null }), /side/);
  assert.throws(() => cleanInjury({ ...base, severity: 9 }), /1 to 5/);
  assert.throws(() => cleanInjury({ ...base, endDay: "2026-09-01" }), /before/);
  // A side on a middle-of-the-body area is dropped, not refused.
  assert.equal(cleanInjury({ ...base, area: "neck" }).side, null);
});

test("active ones come first, worst on top", () => {
  const mk = (id: string, over: Partial<InjuryData>): InjuryData => ({ ...base, id, source: "athlete", ...over });
  const list = [
    mk("old", { endDay: "2026-09-22" }),
    mk("mild", { severity: 1 }),
    mk("bad", { severity: 4 }),
  ];
  assert.deepEqual(sortInjuries(list, "2026-09-28").map((i) => i.id), ["bad", "mild", "old"]);
});

test("the map colours a region once, by its worst injury, on the side that hurts", () => {
  assert.deepEqual(regionMarks([{ area: "knee", side: "L", severity: 2 }]), [{ region: "knees", side: "L", severity: 2 }]);
  // Both knees: the whole region, at the worse one.
  assert.deepEqual(regionMarks([
    { area: "knee", side: "L", severity: 2 },
    { area: "knee", side: "R", severity: 4 },
  ]), [{ region: "knees", side: null, severity: 4 }]);
  // An elbow and a forearm share the forearm region.
  assert.deepEqual(regionMarks([{ area: "elbow", side: "R", severity: 3 }, { area: "forearm", side: "R", severity: 1 }]), [{ region: "forearm", side: "R", severity: 3 }]);
  assert.deepEqual(areasIn("forearm").map((a) => a.id), ["elbow", "forearm"]);
});
