import assert from "node:assert/strict";
import { test } from "node:test";
import { olderThan, tooOld, VERSION_HEADER } from "@/lib/desktop-version";

test("versions compare by number, not by text", () => {
  assert.equal(olderThan("0.4.0", "0.5.0"), true);
  assert.equal(olderThan("0.10.0", "0.9.0"), false);
  assert.equal(olderThan("0.5.0", "0.5.0"), false);
  assert.equal(olderThan("0.5", "0.5.1"), true);
  assert.equal(olderThan("1.0.0", "0.99.99"), false);
});

test("a desktop app that sends no version counts as the oldest", () => {
  const bare = new Request("http://x/");
  const sent = new Request("http://x/", { headers: { [VERSION_HEADER]: "0.6.0" } });
  assert.equal(tooOld(bare, "0.0.0"), null);
  assert.match(tooOld(bare, "0.5.0") ?? "", /too old/);
  assert.equal(tooOld(sent, "0.5.0"), null);
});
