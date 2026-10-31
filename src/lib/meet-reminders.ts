import { addDays } from "@/lib/schedule";

/**
 * The reminders the athlete app sends about a meet, on the morning run: what is left on
 * their list two weeks out, a week to go, weigh-in the day before, the meet morning, and the
 * result the day after. The coach's Road tab shows the same texts, so both read them here.
 */
export type ReminderKind = "list" | "week" | "eve" | "morning" | "results";

export const REMINDER_KINDS: ReminderKind[] = ["list", "week", "eve", "morning", "results"];

/** Days from the meet each one goes out. */
export const REMINDER_OFFSET: Record<ReminderKind, number> = { list: -14, week: -7, eve: -1, morning: 0, results: 1 };

/** A new meet has every reminder on but the result, which some coaches would rather give themselves. */
const ON_BY_DEFAULT: Record<ReminderKind, boolean> = { list: true, week: true, eve: true, morning: true, results: false };

export type ReminderText = { title: string; body: string };

export type ReminderSettings = { on: Record<ReminderKind, boolean>; text: Partial<Record<ReminderKind, ReminderText>> };

const isKind = (k: string): k is ReminderKind => (REMINDER_KINDS as string[]).includes(k);

/** `Meet.reminders` read back: what the coach switched from the default, and what they reworded. */
export function parseReminders(json: string | null | undefined): ReminderSettings {
  const out: ReminderSettings = { on: { ...ON_BY_DEFAULT }, text: {} };
  try {
    const raw: unknown = JSON.parse(json ?? "{}");
    if (!raw || typeof raw !== "object") return out;
    const { on, text } = raw as { on?: Record<string, unknown>; text?: Record<string, unknown> };
    for (const [k, v] of Object.entries(on ?? {})) if (isKind(k) && typeof v === "boolean") out.on[k] = v;
    for (const [k, v] of Object.entries(text ?? {})) {
      const t = v as Partial<ReminderText> | null;
      if (isKind(k) && typeof t?.title === "string" && typeof t.body === "string") out.text[k] = { title: t.title, body: t.body };
    }
  } catch {
    // Unreadable counts as never changed.
  }
  return out;
}

/** Only what differs from the defaults is kept; null when nothing does. */
export function serializeReminders(settings: ReminderSettings): string | null {
  const on = Object.fromEntries(REMINDER_KINDS.filter((k) => settings.on[k] !== ON_BY_DEFAULT[k]).map((k) => [k, settings.on[k]]));
  const text = Object.fromEntries(REMINDER_KINDS.filter((k) => settings.text[k]).map((k) => [k, settings.text[k]]));
  if (Object.keys(on).length === 0 && Object.keys(text).length === 0) return null;
  return JSON.stringify({ ...(Object.keys(on).length ? { on } : {}), ...(Object.keys(text).length ? { text } : {}) });
}

export const reminderDay = (kind: ReminderKind, meetDay: string) => addDays(meetDay, REMINDER_OFFSET[kind]);

/** What a reminder can say about the meet. */
export type ReminderFacts = {
  meet: string;
  /** The meet's date, `YYYY-MM-DD`. */
  day: string;
  /** Weigh-in, when the coach has set it; with no day it is on the meet's. */
  weighInDay: string | null;
  weighInTime: string | null;
  startTime: string | null;
  session: string | null;
  racks: { squat: string | null; bench: string | null };
  /** Squat, bench and deadlift openers, when the athlete app shows the attempts. */
  openers: (number | null)[] | null;
  /** The athlete's things still to sort. */
  open: string[];
  /** Once every attempt is called: the total, and the best of each lift by its label. */
  result: { total: number; lifts: { label: string; weight: number }[] } | null;
  unit: string;
};

type Translate = (text: string, vars?: Record<string, string | number>) => string;

/** What the reminder says by default, or null when there is nothing to say: no list left, no result yet. */
export function reminderText(kind: ReminderKind, f: ReminderFacts, t: Translate): ReminderText | null {
  const sent = reminderDay(kind, f.day);
  const weighDay = f.weighInDay ?? f.day;
  const openers = f.openers?.filter((w): w is number => w !== null) ?? [];
  const openersLine = openers.length ? t("Openers: {list}.", { list: openers.join(" · ") }) : "";
  const racks = [f.racks.squat && t("squat {n}", { n: f.racks.squat }), f.racks.bench && t("bench {n}", { n: f.racks.bench })].filter(Boolean);
  const racksLine = racks.length ? t("Racks: {list}.", { list: racks.join(", ") }) : "";
  const sessionLine =
    f.session && f.startTime
      ? t("{session} from {time}.", { session: f.session, time: f.startTime })
      : f.session
        ? `${f.session}.`
        : f.startTime
          ? t("Lifting from {time}.", { time: f.startTime })
          : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");

  switch (kind) {
    case "list":
      if (f.open.length === 0) return null;
      return {
        title: t(f.open.length === 1 ? "1 thing left to sort for {meet}" : "{n} things left to sort for {meet}", { n: f.open.length, meet: f.meet }),
        body: t("{items}. Tap to tick them off.", { items: f.open.join(", ") }),
      };
    case "week":
      return { title: t("{meet} is in {n} days", { meet: f.meet, n: 7 }), body: t("One week to go. Trust the plan.") };
    case "eve": {
      const title =
        f.weighInTime && weighDay === sent
          ? t("Weigh-in today at {time}", { time: f.weighInTime })
          : f.weighInTime && weighDay === addDays(sent, 1)
            ? t("Weigh-in tomorrow at {time}", { time: f.weighInTime })
            : t("{meet} is tomorrow", { meet: f.meet });
      return { title, body: join(t("Pack your food and drink."), openersLine) };
    }
    case "morning":
      return {
        title: f.weighInTime && weighDay === f.day ? t("Meet day. Weigh-in at {time}", { time: f.weighInTime }) : t("Meet day: {meet}", { meet: f.meet }),
        body: join(sessionLine, racksLine) || t("Trust your openers."),
      };
    case "results":
      if (!f.result) return null;
      return {
        title: t("Your results from {meet}", { meet: f.meet }),
        body: `${t("Total {n} {u}", { n: f.result.total, u: f.unit })}: ${f.result.lifts.map((l) => `${l.label} ${l.weight}`).join(", ")}.`,
      };
  }
}
