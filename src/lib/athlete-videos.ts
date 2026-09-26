/**
 * The rules for videos athletes send from the athlete app, shared by the phone, the server
 * and the coach's desktop app. The files live in object storage (`storage.ts`); the
 * database only has an `AthleteVideo` row per file.
 */

/** File types the phone may send, and the extension each is kept under. */
export const CLIP_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/3gpp": "3gp",
  "video/x-m4v": "m4v",
};

/**
 * The largest file accepted. A 20 s top set shrunk on the phone is about 4 MB; this leaves
 * room for a phone that can't shrink it and sends the original.
 */
export const MAX_CLIP_BYTES = 200 * 1024 * 1024;

/** A clip already this small is sent as it is: shrinking it would gain little. */
export const SHRINK_ABOVE_BYTES = 8 * 1024 * 1024;

/** Set numbers a video can be filed under: as many as a row can log. */
export const MAX_SET_INDEX = 29;

export function cleanSetIndex(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SET_INDEX ? value : null;
}

/** Videos per exercise, and per athlete per day, so a stuck button can't fill the bucket. */
export const MAX_CLIPS_PER_ROW = 10;
export const MAX_CLIPS_PER_DAY = 60;

/** How long a clip is kept in storage, unless the server says otherwise. Match the bucket's lifecycle rule. */
export const DEFAULT_RETENTION_DAYS = 30;

export function retentionDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TOPSET_VIDEO_RETENTION_DAYS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

/** The type a phone reported, cleaned to one Topset accepts; phones sometimes report none. */
export function clipType(type: string, name: string): string | null {
  const t = type.toLowerCase().split(";")[0].trim();
  if (t in CLIP_TYPES) return t;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (t === "" || t === "application/octet-stream") {
    const found = Object.entries(CLIP_TYPES).find(([, e]) => e === ext || (ext === "qt" && e === "mov"));
    return found ? found[0] : null;
  }
  return null;
}

/**
 * The name the coach's copy is saved under: the day, the exercise and the name it came
 * with, and the set when the athlete said which — `2026-09-26 Squat set 2 IMG_1234.mp4` —
 * with the extension of what was actually sent.
 */
export function clipFileName(day: string, exercise: string, name: string, contentType: string, setIndex: number | null = null): string {
  const ext = CLIP_TYPES[contentType] ?? "mp4";
  const stem = name.replace(/\.[^.]*$/, "");
  const clean = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const set = setIndex === null ? "" : `set ${setIndex + 1}`;
  const parts = [day, clean(exercise).slice(0, 40), set, clean(stem).slice(0, 60)].filter(Boolean);
  return `${parts.join(" ")}.${ext}`;
}

/** A clip as the athlete app shows it. */
export type ClipView = {
  id: string;
  name: string;
  /** The set it shows, 0-based, or null when not said. */
  setIndex: number | null;
  size: number;
  uploadedAt: string;
  /** A signed link to play it from storage, good for a few hours. */
  url: string;
  /** Days left before storage lets it go. */
  daysLeft: number;
};
