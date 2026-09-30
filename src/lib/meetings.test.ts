import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanMeeting, cleanZone, inZone, meetingNews, placeLink, timeSpan, validMeeting, waitingOn } from "@/lib/meetings";

test("a meeting is checked as typed in", () => {
  assert.deepEqual(cleanMeeting({ day: "2026-10-02", time: "18:00", minutes: 30, place: "  Gym  ", note: "" }, "2026-10-01"), {
    day: "2026-10-02",
    time: "18:00",
    minutes: 30,
    timeZone: null,
    place: "Gym",
    note: null,
  });
  assert.throws(() => cleanMeeting({ day: "2026-09-30", time: "18:00", minutes: 30 }, "2026-10-01"));
  assert.throws(() => cleanMeeting({ day: "2026-10-02", time: "25:00", minutes: 30 }, "2026-10-01"));
  assert.throws(() => cleanMeeting({ day: "2026-10-02", time: "18:00", minutes: 0 }, "2026-10-01"));
});

test("the side that didn't propose answers", () => {
  assert.equal(waitingOn({ status: "PROPOSED", proposedBy: "athlete" }), "coach");
  assert.equal(waitingOn({ status: "PROPOSED", proposedBy: "coach" }), "athlete");
  assert.equal(waitingOn({ status: "ACCEPTED", proposedBy: "coach" }), null);
});

test("sync takes only well-formed meetings", () => {
  const ok = { time: "09:30", minutes: 45, proposedBy: "coach", status: "PROPOSED" };
  assert.ok(validMeeting(ok));
  assert.ok(!validMeeting({ ...ok, status: "MAYBE" }));
  assert.ok(!validMeeting({ ...ok, proposedBy: "someone" }));
  assert.ok(!validMeeting({ ...ok, time: "9:30" }));
});

test("only links open as links", () => {
  assert.equal(placeLink("https://meet.example.com/abc"), "https://meet.example.com/abc");
  assert.equal(placeLink("javascript:alert(1)"), null);
  assert.equal(placeLink("The gym"), null);
  assert.equal(timeSpan("23:45", 30), "23:45–00:15");
});

test("the athlete hears about what the coach changed", () => {
  const coachProposal = { day: "2026-10-02", time: "18:00", minutes: 30, place: null, proposedBy: "coach", status: "PROPOSED" };
  const athleteProposal = { ...coachProposal, proposedBy: "athlete" };
  assert.equal(meetingNews(undefined, coachProposal), "proposed");
  assert.equal(meetingNews(coachProposal, coachProposal), null);
  assert.equal(meetingNews(coachProposal, { ...coachProposal, time: "19:00" }), "proposed");
  assert.equal(meetingNews(athleteProposal, { ...athleteProposal, status: "ACCEPTED" }), "accepted");
  assert.equal(meetingNews(athleteProposal, { ...athleteProposal, status: "DECLINED" }), "declined");
  // The athlete's own answer coming back is no news.
  assert.equal(meetingNews(coachProposal, { ...coachProposal, status: "ACCEPTED" }), null);
  assert.equal(meetingNews({ ...coachProposal, status: "ACCEPTED" }, { ...coachProposal, status: "CANCELLED" }), "cancelled");
  assert.equal(meetingNews(coachProposal, { ...coachProposal, deletedAt: "2026-10-01" }), "cancelled");
  assert.equal(meetingNews(undefined, { ...athleteProposal, status: "ACCEPTED" }), null);
});

test("a meeting reads on the other side's clock", () => {
  const m = { day: "2026-10-02", time: "18:00", timeZone: "Europe/Luxembourg" };
  assert.deepEqual(inZone(m, "Europe/London"), { day: "2026-10-02", time: "17:00" });
  assert.deepEqual(inZone(m, "America/New_York"), { day: "2026-10-02", time: "12:00" });
  assert.deepEqual(inZone({ ...m, time: "23:30" }, "Asia/Tokyo"), { day: "2026-10-03", time: "06:30" });
  // Same zone, no zone on file, or the same clock: nothing to show.
  assert.equal(inZone(m, "Europe/Luxembourg"), null);
  assert.equal(inZone({ ...m, timeZone: null }, "Europe/London"), null);
  assert.equal(inZone(m, "Europe/Paris"), null);
  // Across the autumn clock change.
  assert.deepEqual(inZone({ day: "2026-10-25", time: "12:00", timeZone: "Europe/Luxembourg" }, "UTC"), { day: "2026-10-25", time: "11:00" });
});

test("only real zones are kept", () => {
  assert.equal(cleanZone("Europe/Luxembourg"), "Europe/Luxembourg");
  assert.equal(cleanZone("Mars/Olympus"), null);
  assert.equal(cleanZone(42), null);
  assert.ok(!validMeeting({ time: "09:30", minutes: 45, proposedBy: "coach", status: "PROPOSED", timeZone: "Nowhere" }));
});
