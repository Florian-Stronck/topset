import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanReason, moveId, moveProblem, movesMap } from "@/lib/moves";

test("a move is named after its session", () => {
  assert.equal(moveId("d1"), "mv-d1");
  assert.deepEqual([...movesMap([{ dayId: "d1", day: "2026-10-02" }])], [["d1", "2026-10-02"]]);
});

test("a session moves to a free day, today or later, not too far off", () => {
  const taken = new Set(["2026-10-03"]);
  assert.equal(moveProblem("2026-10-01", "2026-10-02", "2026-09-30", taken), null);
  assert.equal(moveProblem("2026-10-01", "2026-10-01", "2026-10-05", taken), null);
  assert.equal(moveProblem("2026-10-01", "2026-10-03", "2026-09-30", taken), "There's already a session on that day.");
  assert.equal(moveProblem("2026-10-01", "2026-09-29", "2026-09-30", taken), "Pick today or a day still to come.");
  assert.equal(moveProblem("2026-10-01", "2026-12-01", "2026-09-30", taken), "That's too far from the planned day.");
  assert.equal(moveProblem("2026-10-01", "soon", "2026-09-30", taken), "That day isn't a date.");
  // A missed session can still be made up.
  assert.equal(moveProblem("2026-09-28", "2026-09-30", "2026-09-30", taken), null);
});

test("a reason is trimmed, empty is none, too long is refused", () => {
  assert.equal(cleanReason("  sick  "), "sick");
  assert.equal(cleanReason("   "), null);
  assert.equal(cleanReason(undefined), null);
  assert.throws(() => cleanReason("x".repeat(501)));
});
