import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "@/lib/chart-library";
import type { ChartSpec } from "@/lib/settings";

const base: Omit<ChartSpec, "kind" | "metrics"> = { id: "c", title: "C", by: "week", range: 28 };

test("charts saved before combo charts read as combos", () => {
  const line = normalize({ ...base, kind: "line", metrics: [{ id: "bw" }, { id: "kcal", bars: true }] });
  assert.equal(line.kind, "combo");
  assert.deepEqual(line.metrics, [
    { type: "line", axis: "left", id: "bw" },
    { id: "kcal", type: "bar", axis: "right" },
  ]);
  const stacked = normalize({ ...base, kind: "stacked", metrics: [{ id: "tonnage:squat" }] });
  assert.equal(stacked.stack, true);
  assert.equal(stacked.metrics[0].type, "bar");
  const pie: ChartSpec = { ...base, kind: "pie", metrics: [{ id: "x" }] };
  assert.equal(normalize(pie), pie);
});
