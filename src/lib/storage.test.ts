import assert from "node:assert/strict";
import { test } from "node:test";
import { presign, storageConfig } from "@/lib/storage";

// The worked example in AWS's "Authenticating Requests: Using Query Parameters" guide.
const aws = {
  endpoint: "https://examplebucket.s3.amazonaws.com",
  bucket: "",
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

test("signs AWS's own presigned GET example to the same signature", () => {
  const url = presign(aws, { method: "GET", key: "test.txt", expiresIn: 86400, now: new Date("2013-05-24T00:00:00Z") });
  assert.equal(
    url,
    "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
  );
});

test("puts the bucket in the path and signs the upload's headers", () => {
  const r2 = { ...aws, endpoint: "https://acc.r2.cloudflarestorage.com", bucket: "topset", region: "auto" };
  const url = new URL(
    presign(r2, {
      method: "PUT",
      key: "v/athlete 1/clip.mp4",
      expiresIn: 900,
      headers: { "Content-Type": "video/mp4", "Content-Length": "123" },
    }),
  );
  assert.equal(url.pathname, "/topset/v/athlete%201/clip.mp4");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host");
  assert.match(url.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
});

test("reads the bucket from the environment, R2 account id or endpoint", () => {
  const keys = { TOPSET_VIDEO_BUCKET: "b", TOPSET_VIDEO_ACCESS_KEY_ID: "k", TOPSET_VIDEO_SECRET_ACCESS_KEY: "s" };
  assert.equal(storageConfig({}), null);
  assert.equal(storageConfig(keys), null);
  assert.equal(storageConfig({ ...keys, TOPSET_R2_ACCOUNT_ID: "abc" })?.endpoint, "https://abc.r2.cloudflarestorage.com");
  assert.equal(storageConfig({ ...keys, TOPSET_VIDEO_ENDPOINT: "https://s3.example.com/" })?.endpoint, "https://s3.example.com");
  assert.equal(storageConfig({ ...keys, TOPSET_R2_ACCOUNT_ID: "abc" })?.region, "auto");
});
