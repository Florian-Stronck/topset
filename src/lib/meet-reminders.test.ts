import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseReminders, reminderDay, reminderText, serializeReminders, type ReminderFacts } from "@/lib/meet-reminders";
import { validMergedRow } from "@/lib/sync-plan";

// The English text as it is, with the blanks filled.
const t = (text: string, vars: Record<string, string | number> = {}) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

const facts: ReminderFacts = {
  meet: "Nationals",
  day: "2026-12-05",
  weighInDay: null,
  weighInTime: "07:00",
  startTime: "09:00",
  session: "Session 1, flight B",
  racks: { squat: "12", bench: "8" },
  openers: [155, 80, 165],
  open: ["Long socks", "Weigh-in food"],
  result: null,
  unit: "kg",
};

describe("meet reminders", () => {
  test("each goes out on its day around the meet", () => {
    assert.equal(reminderDay("list", "2026-12-05"), "2026-11-21");
    assert.equal(reminderDay("eve", "2026-12-05"), "2026-12-04");
    assert.equal(reminderDay("results", "2026-12-05"), "2026-12-06");
  });
  test("the day before names weigh-in and the openers", () => {
    assert.deepEqual(reminderText("eve", facts, t), { title: "Weigh-in tomorrow at 07:00", body: "Pack your food and drink. Openers: 155 · 80 · 165." });
  });
  test("a 24-hour weigh-in is today on the day before", () => {
    assert.equal(reminderText("eve", { ...facts, weighInDay: "2026-12-04" }, t)?.title, "Weigh-in today at 07:00");
    assert.equal(reminderText("morning", { ...facts, weighInDay: "2026-12-04" }, t)?.title, "Meet day: Nationals");
  });
  test("the meet morning gives the session and racks", () => {
    assert.deepEqual(reminderText("morning", facts, t), { title: "Meet day. Weigh-in at 07:00", body: "Session 1, flight B from 09:00. Racks: squat 12, bench 8." });
  });
  test("nothing to say, nothing sent", () => {
    assert.equal(reminderText("list", { ...facts, open: [] }, t), null);
    assert.equal(reminderText("results", facts, t), null);
    assert.equal(reminderText("eve", { ...facts, openers: null }, t)?.body, "Pack your food and drink.");
  });
  test("only what differs from the defaults is stored", () => {
    const settings = parseReminders(null);
    assert.equal(settings.on.results, false);
    assert.equal(serializeReminders(settings), null);
    settings.on.week = false;
    settings.text.eve = { title: "Sleep well", body: "" };
    const json = serializeReminders(settings);
    assert.deepEqual(parseReminders(json), settings);
    assert.deepEqual(parseReminders("nonsense"), parseReminders(null));
  });
});

describe("meet checklist sync", () => {
  const row = { id: "t1", athleteId: "a1", meetId: "m1", day: "2026-12-05", text: "Hotel", owner: "athlete", done: 1, doneBy: "athlete", order: 0, createdAt: "x", updatedAt: "x", deletedAt: null };
  test("a row from either side merges when it is whole", () => {
    assert.equal(validMergedRow("MeetTask", row), true);
    assert.equal(validMergedRow("MeetTask", { ...row, owner: "someone" }), false);
    assert.equal(validMergedRow("MeetTask", { ...row, meetId: "" }), false);
    assert.equal(validMergedRow("MeetTask", { ...row, day: "5 Dec" }), false);
  });
});
