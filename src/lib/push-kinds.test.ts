import assert from "node:assert/strict";
import { test } from "node:test";
import { pushServiceEndpoint } from "@/lib/push-kinds";

test("only the browsers' push services take sign-ups", () => {
  assert.equal(pushServiceEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(pushServiceEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc"), true);
  assert.equal(pushServiceEndpoint("https://web.push.apple.com/QK"), true);
  assert.equal(pushServiceEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x"), true);
  assert.equal(pushServiceEndpoint("https://169.254.169.254/latest"), false);
  assert.equal(pushServiceEndpoint("https://evil.example/fcm.googleapis.com"), false);
  assert.equal(pushServiceEndpoint("https://fcm.googleapis.com.evil.example/x"), false);
  assert.equal(pushServiceEndpoint("https://fcm.googleapis.com:8443/x"), false);
  assert.equal(pushServiceEndpoint("http://fcm.googleapis.com/x"), false);
  assert.equal(pushServiceEndpoint("not a url"), false);
});
