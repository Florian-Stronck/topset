import assert from "node:assert/strict";
import { test } from "node:test";
import { serial } from "@/lib/serial";

const tick = () => new Promise((r) => setTimeout(r, 5));

test("is free again once a job finishes, so the next tick runs", async () => {
  const queue = serial();
  await queue.run(async () => tick());
  assert.equal(queue.busy(), false);
  let ran = false;
  await queue.run(async () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.equal(queue.busy(), false);
});

test("jobs never overlap, and one queued behind keeps it busy", async () => {
  const queue = serial();
  const order: string[] = [];
  const a = queue.run(async () => {
    order.push("a start");
    await tick();
    order.push("a end");
  });
  const b = queue.run(async () => {
    order.push("b");
  });
  assert.equal(queue.busy(), true);
  await a;
  await b;
  assert.deepEqual(order, ["a start", "a end", "b"]);
  await tick();
  assert.equal(queue.busy(), false);
});

test("a failed job doesn't block the ones after it", async () => {
  const queue = serial();
  await assert.rejects(queue.run(async () => Promise.reject(new Error("offline"))));
  assert.equal(queue.busy(), false);
  assert.equal(await queue.run(async () => 42), 42);
});
