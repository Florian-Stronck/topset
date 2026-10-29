/**
 * The Overview's inbox: everything waiting on the coach, across every athlete, as one list
 * — sessions to review, messages, moved sessions and meeting requests, and what the
 * roster's flags say needs fixing. Each item has a key that stays the same while the thing
 * does, so the coach can snooze it; snoozes live on this computer.
 */

export type InboxKind = "session" | "message" | "meeting" | "move" | "program" | "training" | "wellness" | "weight" | "link" | "pr";

/** The chips across the top of the queue: what kinds each one shows. */
export type InboxFilter = "all" | "sessions" | "messages" | "schedule" | "program" | "training" | "wellness" | "link" | "pr";

export const FILTER_OF: Record<InboxKind, Exclude<InboxFilter, "all">> = {
  session: "sessions",
  message: "messages",
  meeting: "schedule",
  move: "schedule",
  program: "program",
  training: "training",
  wellness: "wellness",
  weight: "wellness",
  link: "link",
  pr: "pr",
};

/** One exercise of a session to review, as the detail pane lists it. */
export type ReviewLine = {
  id: string;
  exercise: string;
  /** "3 × 3 · RPE 8". */
  prescribed: string;
  /** Each set done: "160×3 @8.5", flagged when it ran over the prescribed RPE. */
  sets: { text: string; over: boolean; pr: boolean }[];
  /** Logged RPE against the plan; null when there's nothing to compare. */
  delta: number | null;
  note: string | null;
  video: boolean;
};

export type SessionDetail = {
  dayId: string;
  ymd: string;
  label: string;
  phase: string;
  week: number;
  done: number;
  prescribed: number;
  /** When the last set came in, ISO. */
  last: string;
  lines: ReviewLine[];
};

export type InboxItem = {
  key: string;
  athleteId: string;
  athlete: string;
  kind: InboxKind;
  text: string;
  /** Today rather than this week. */
  urgent: boolean;
  /** When it came in, ISO; null for what the roster works out. */
  at: string | null;
  /** Where to go and fix it. */
  href: string;
  hrefLabel: string;
  session?: SessionDetail;
  message?: { recent: { body: string; mine: boolean; at: string }[] };
  meetingId?: string;
  moveId?: string;
};

/** Hidden for good, until the coach brings it back. */
export const FOREVER = "9999-12-31";

/** Snoozed: hidden while today is before the day it comes back. */
export function isSnoozed(snoozes: Record<string, string>, key: string, today: string): boolean {
  return (snoozes[key] ?? "") > today;
}

/** The snoozes still running, so the list on this computer doesn't grow forever. */
export function liveSnoozes(snoozes: Record<string, string>, today: string): Record<string, string> {
  return Object.fromEntries(Object.entries(snoozes).filter(([, until]) => until > today));
}

const RANK = (i: InboxItem) => (i.urgent ? 0 : i.kind === "pr" ? 2 : 1);

/** Urgent first, good news last; within that the newest, then by name. */
export function byUrgency(a: InboxItem, b: InboxItem): number {
  return RANK(a) - RANK(b) || (b.at ?? "").localeCompare(a.at ?? "") || a.athlete.localeCompare(b.athlete);
}

/** How a logged set reads: weight × reps, then its effort. */
export function setText(log: { weight: number | null; reps: number | null; rpe: number | null; rir: number | null; seconds?: number | null }): string {
  const lift = log.weight === null ? (log.seconds ? `${log.seconds}s` : "—") : log.reps === null ? `${log.weight}` : `${log.weight}×${log.reps}`;
  const effort = log.rpe !== null ? ` @${log.rpe}` : log.rir !== null ? ` RIR ${log.rir}` : "";
  return lift + effort;
}
