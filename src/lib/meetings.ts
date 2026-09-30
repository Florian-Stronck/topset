/**
 * Meetings between coach and athlete: a call or a sit-down, at a day and time both read on
 * their own wall clock. Either side proposes; the other accepts or declines. Changing the
 * day, time or place proposes it afresh from whoever changed it, so an answer always goes
 * to the time on file. Kept free of the database so sync can check rows with it.
 */

export const MEETING_STATUSES = ["PROPOSED", "ACCEPTED", "DECLINED", "CANCELLED"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export type Side = "athlete" | "coach";

export const MEETING_LENGTHS = [15, 30, 45, 60, 90] as const;
export const MAX_MEETING_MINUTES = 240;
export const MAX_PLACE = 300;
export const MAX_MEETING_NOTE = 1000;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type MeetingData = {
  id: string;
  day: string;
  time: string;
  minutes: number;
  /** The zone `day` and `time` are written in; null when not known. */
  timeZone: string | null;
  place: string | null;
  note: string | null;
  proposedBy: Side;
  status: MeetingStatus;
  updatedAt: string;
};

export type MeetingInput = {
  day: string;
  time: string;
  minutes: number;
  /** The zone of whoever typed it in, from their browser. */
  timeZone?: string | null;
  place?: string | null;
  note?: string | null;
};

export function meetingData(row: {
  id: string;
  day: string;
  time: string;
  minutes: number;
  timeZone: string | null;
  place: string | null;
  note: string | null;
  proposedBy: string;
  status: string;
  updatedAt: Date;
}): MeetingData {
  return {
    id: row.id,
    day: row.day,
    time: row.time,
    minutes: row.minutes,
    timeZone: row.timeZone,
    place: row.place,
    note: row.note,
    proposedBy: row.proposedBy === "athlete" ? "athlete" : "coach",
    status: (MEETING_STATUSES as readonly string[]).includes(row.status) ? (row.status as MeetingStatus) : "PROPOSED",
    updatedAt: row.updatedAt.toISOString(),
  };
}

function text(value: unknown, max: number, what: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`That ${what} isn't text.`);
  const out = value.trim();
  if (out === "") return null;
  if (out.length > max) throw new Error(`That ${what} is too long.`);
  return out;
}

/** A meeting as typed in, checked; `today` keeps it from being set in the past. */
export function cleanMeeting(input: MeetingInput, today: string): Required<MeetingInput> {
  if (!YMD.test(input.day) || Number.isNaN(Date.parse(input.day))) throw new Error("That day isn't a date.");
  if (input.day < today) throw new Error("Pick today or a day still to come.");
  if (!HM.test(input.time)) throw new Error("That time isn't a time.");
  const minutes = Math.round(Number(input.minutes));
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > MAX_MEETING_MINUTES) throw new Error("That length doesn't look right.");
  return {
    day: input.day,
    time: input.time,
    minutes,
    timeZone: cleanZone(input.timeZone),
    place: text(input.place, MAX_PLACE, "place"),
    note: text(input.note, MAX_MEETING_NOTE, "note"),
  };
}

/** A meeting row as sync may write it. */
export function validMeeting(row: Record<string, unknown>): boolean {
  return (
    typeof row.time === "string" &&
    HM.test(row.time) &&
    typeof row.minutes === "number" &&
    Number.isInteger(row.minutes) &&
    row.minutes > 0 &&
    row.minutes <= MAX_MEETING_MINUTES &&
    (row.timeZone === null || row.timeZone === undefined || cleanZone(row.timeZone) !== null) &&
    (row.proposedBy === "athlete" || row.proposedBy === "coach") &&
    typeof row.status === "string" &&
    (MEETING_STATUSES as readonly string[]).includes(row.status)
  );
}

/** An IANA zone the runtime knows, or null. */
export function cleanZone(zone: unknown): string | null {
  if (typeof zone !== "string" || zone === "" || zone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A zone's wall clock at an instant, as `YYYY-MM-DD` and `HH:MM`. */
function wallClock(ms: number, zone: string): { day: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The instant a wall-clock day and time happen in a zone. */
export function instantOf(day: string, time: string, zone: string): number {
  const naive = Date.parse(`${day}T${time}:00Z`);
  const offset = (ms: number) => {
    const w = wallClock(ms, zone);
    return Date.parse(`${w.day}T${w.time}:00Z`) - ms;
  };
  // Twice, so a guess on the far side of a clock change still lands.
  const first = naive - offset(naive);
  return naive - offset(first);
}

/**
 * The meeting on another zone's clock, when it was written in a different one and reads
 * differently there; null when there is nothing to convert.
 */
export function inZone(m: Pick<MeetingData, "day" | "time" | "timeZone">, zone: string | null): { day: string; time: string } | null {
  if (!m.timeZone || !zone || m.timeZone === zone) return null;
  const there = wallClock(instantOf(m.day, m.time, m.timeZone), zone);
  return there.day === m.day && there.time === m.time ? null : there;
}

/** Who has to answer: the side that didn't propose, while it's still a proposal. */
export function waitingOn(m: Pick<MeetingData, "status" | "proposedBy">): Side | null {
  if (m.status !== "PROPOSED") return null;
  return m.proposedBy === "athlete" ? "coach" : "athlete";
}

/** Still ahead, or today, and not called off. */
export function isUpcoming(m: Pick<MeetingData, "day" | "status">, today: string): boolean {
  return m.day >= today && (m.status === "PROPOSED" || m.status === "ACCEPTED");
}

/** Soonest first. */
export function byWhen(a: Pick<MeetingData, "day" | "time">, b: Pick<MeetingData, "day" | "time">): number {
  return a.day.localeCompare(b.day) || a.time.localeCompare(b.time);
}

/** The place as a link to open, when it is one; plain text otherwise. */
export function placeLink(place: string | null): string | null {
  if (!place) return null;
  const url = URL.parse(place.trim());
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.toString() : null;
}

/** "18:00–18:30". */
export function timeSpan(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const end = (h * 60 + m + minutes) % (24 * 60);
  return `${time}–${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}

export type MeetingNews = "proposed" | "accepted" | "declined" | "cancelled";

/**
 * What the athlete should hear about a meeting the coach's app sent up, given the copy the
 * server had (none for a new one). Only changes the coach made count; a row coming back
 * as the athlete left it is news to no one.
 */
export function meetingNews(held: Record<string, unknown> | undefined, row: Record<string, unknown>): MeetingNews | null {
  if (row.deletedAt) return held && !held.deletedAt && held.status !== "CANCELLED" && held.status !== "DECLINED" ? "cancelled" : null;
  const same = (k: string) => held !== undefined && (held[k] ?? null) === (row[k] ?? null);
  if (same("status") && same("day") && same("time") && same("place") && same("minutes") && same("proposedBy")) return null;
  if (row.status === "PROPOSED") return row.proposedBy === "coach" ? "proposed" : null;
  if (row.status === "CANCELLED") return held && held.status !== "CANCELLED" ? "cancelled" : null;
  if (held?.status !== "PROPOSED" || held.proposedBy !== "athlete") return null;
  if (row.status === "ACCEPTED") return "accepted";
  if (row.status === "DECLINED") return "declined";
  return null;
}
