import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSetIndex, clipFileName, clipType, retentionDays } from "@/lib/athlete-videos";

test("takes the video types phones send, and guesses from the name when they send none", () => {
  assert.equal(clipType("video/mp4", "a.mp4"), "video/mp4");
  assert.equal(clipType("video/quicktime; codecs=hvc1", "IMG_1.MOV"), "video/quicktime");
  assert.equal(clipType("", "IMG_1.MOV"), "video/quicktime");
  assert.equal(clipType("application/octet-stream", "clip.mp4"), "video/mp4");
  assert.equal(clipType("image/png", "a.png"), null);
  assert.equal(clipType("", "notes.txt"), null);
});

test("names the coach's copy by day, exercise and the phone's name, with the sent type's extension", () => {
  assert.equal(clipFileName("2026-09-26", "Squat", "IMG_1234.MOV", "video/mp4"), "2026-09-26 Squat IMG_1234.mp4");
  assert.equal(clipFileName("2026-09-26", "Bench: paused / 2ct", "a.mov", "video/quicktime"), "2026-09-26 Bench paused 2ct a.mov");
  assert.equal(clipFileName("2026-09-26", "", "x.webm", "video/webm"), "2026-09-26 x.webm");
  assert.equal(clipFileName("2026-09-26", "Squat", "IMG_1.MOV", "video/mp4", 1), "2026-09-26 Squat set 2 IMG_1.mp4");
});

test("keeps videos 30 days unless the server says otherwise", () => {
  assert.equal(retentionDays({}), 30);
  assert.equal(retentionDays({ TOPSET_VIDEO_RETENTION_DAYS: "60" }), 60);
  assert.equal(retentionDays({ TOPSET_VIDEO_RETENTION_DAYS: "soon" }), 30);
});

test("files a video under a real set number or none", () => {
  assert.equal(cleanSetIndex(0), 0);
  assert.equal(cleanSetIndex(3), 3);
  assert.equal(cleanSetIndex(-1), null);
  assert.equal(cleanSetIndex(1.5), null);
  assert.equal(cleanSetIndex(30), null);
  assert.equal(cleanSetIndex("2"), null);
});
