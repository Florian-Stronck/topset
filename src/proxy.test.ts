import assert from "node:assert/strict";
import { test } from "node:test";
import { localRequest } from "./proxy";

const h = (init: Record<string, string>) => new Headers(init);

test("only the coach's own window reaches the desktop server", () => {
  assert.equal(localRequest(h({ host: "127.0.0.1:47315" })), true);
  assert.equal(localRequest(h({ host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })), true);
  assert.equal(localRequest(h({ host: "127.0.0.1:47315", "sec-fetch-site": "none" })), true);
  // DNS rebinding: the page's own name, pointed at 127.0.0.1.
  assert.equal(localRequest(h({ host: "evil.example:47315" })), false);
  assert.equal(localRequest(h({})), false);
  // Another site posting a backup.
  assert.equal(localRequest(h({ host: "127.0.0.1:47315", origin: "https://evil.example" })), false);
  assert.equal(localRequest(h({ host: "127.0.0.1:47315", "sec-fetch-site": "cross-site" })), false);
  assert.equal(localRequest(h({ host: "127.0.0.1:47315", origin: "null" })), false);
  assert.equal(localRequest(h({ host: "127.0.0.1:47315", origin: "http://127.0.0.1:1234" })), false);
});
