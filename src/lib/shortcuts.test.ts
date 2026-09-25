import assert from "node:assert/strict";
import { test } from "node:test";
import { allBindings, clashes, firesWhileTyping, keysOf, matchStroke } from "@/lib/shortcuts";

test("a command's defaults hold until the coach rebinds it", () => {
  assert.deepEqual(keysOf("week-add", {}), ["alt+w"]);
  assert.deepEqual(keysOf("week-add", { "week-add": ["alt+q"] }), ["alt+q"]);
  assert.deepEqual(keysOf("week-add", { "week-add": [] }), []);
  assert.deepEqual(keysOf("sync-now", {}), []);
});

test("commands that aren't built in can take keys too", () => {
  const bindings = allBindings({ "open-athlete-abc": ["alt+1"] });
  assert.deepEqual(bindings.get("open-athlete-abc"), ["alt+1"]);
  assert.equal(bindings.has("sync-now"), false);
});

test("a stroke runs its command, or waits when it starts a chord", () => {
  const bindings = new Map([
    ["palette", ["mod+k"]],
    ["sync-now", ["mod+k mod+s"]],
    ["week-add", ["alt+w"]],
  ]);
  assert.deepEqual(matchStroke(bindings, "alt+w", null), { run: ["week-add"], chord: false });
  assert.deepEqual(matchStroke(bindings, "mod+k", null), { run: ["palette"], chord: true });
  assert.deepEqual(matchStroke(bindings, "mod+s", "mod+k"), { run: ["sync-now"], chord: false });
  assert.deepEqual(matchStroke(bindings, "alt+w", "mod+k"), { run: [], chord: false });
});

test("a key taken twice, or a chord over another key, is a clash", () => {
  assert.deepEqual(clashes("sync-now", "alt+w", {}), ["week-add"]);
  assert.deepEqual(clashes("sync-now", "mod+k mod+s", {}), ["palette"]);
  assert.deepEqual(clashes("week-add", "alt+w", {}), []);
});

test("only keys with Ctrl, Alt or an F-key fire while typing in a cell", () => {
  assert.equal(firesWhileTyping("alt+w"), true);
  assert.equal(firesWhileTyping("mod+shift+p"), true);
  assert.equal(firesWhileTyping("f2"), true);
  assert.equal(firesWhileTyping("g"), false);
  assert.equal(firesWhileTyping("shift+n"), false);
});
