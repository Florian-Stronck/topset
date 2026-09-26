import fs from "node:fs";
import path from "node:path";
import { databasePath } from "@/lib/backup";

/**
 * Videos an athlete sent the coach, kept on this computer only: a folder beside topset.db
 * with one subfolder per exercise row. Nothing about them is in the database, so they
 * never sync to the server and never end up in a backup (which copies the database).
 */

export const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".3gp": "video/3gpp",
};

export type VideoFile = { name: string; size: number; addedAt: string };

export function videosRoot(): string {
  return path.join(path.dirname(databasePath()), "topset-videos");
}

/** Row ids are cuids or uuids; anything else could climb out of the folder. */
export function safeRowId(rowId: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(rowId);
}

/** A name that is only a file name, with a video extension, and nothing that walks paths. */
export function safeName(name: string): string | null {
  const base = path.basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  if (!base || base.startsWith(".")) return null;
  if (!(path.extname(base).toLowerCase() in VIDEO_TYPES)) return null;
  return base.slice(0, 180);
}

function rowDir(rowId: string): string {
  if (!safeRowId(rowId)) throw new Error("Not a row.");
  return path.join(videosRoot(), rowId);
}

/** The file for a row's video, or null if the name is unsafe or it isn't there. */
export function videoPath(rowId: string, name: string): string | null {
  const clean = safeName(name);
  if (!clean || clean !== name || !safeRowId(rowId)) return null;
  const file = path.join(rowDir(rowId), clean);
  return fs.existsSync(file) ? file : null;
}

export function listVideos(rowId: string): VideoFile[] {
  const dir = rowDir(rowId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && safeName(e.name) === e.name)
    .map((e) => {
      const stat = fs.statSync(path.join(dir, e.name));
      return { name: e.name, size: stat.size, addedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

/** The videos of each of these rows; rows without any are left out. */
export function videoLists(rowIds: string[]): Record<string, VideoFile[]> {
  const root = videosRoot();
  if (!fs.existsSync(root)) return {};
  const wanted = new Set(rowIds);
  const out: Record<string, VideoFile[]> = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !wanted.has(entry.name)) continue;
    const list = listVideos(entry.name);
    if (list.length > 0) out[entry.name] = list;
  }
  return out;
}

/** Where a new upload goes: the name it came with, numbered if that's taken. */
export function newVideoPath(rowId: string, name: string): string | null {
  const clean = safeName(name);
  if (!clean) return null;
  const dir = rowDir(rowId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(clean);
  const stem = clean.slice(0, -ext.length);
  let candidate = clean;
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${stem} (${n})${ext}`;
  return path.join(dir, candidate);
}

export function deleteVideo(rowId: string, name: string): boolean {
  const file = videoPath(rowId, name);
  if (!file) return false;
  fs.rmSync(file, { force: true });
  const dir = path.dirname(file);
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  return true;
}

// --- videos from the athlete app ------------------------------------------------------

/**
 * Which athlete-app videos this computer already has, by `AthleteVideo` id: the file each
 * went into, or null for one that was gone from storage by the time it was asked for.
 * Kept beside the videos rather than in the database, like the videos themselves, so a
 * video the coach deletes here isn't downloaded again.
 */
function ledgerPath(): string {
  return path.join(videosRoot(), ".athlete-videos.json");
}

export function readLedger(): Record<string, string | null> {
  try {
    const data = JSON.parse(fs.readFileSync(ledgerPath(), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function writeLedger(ledger: Record<string, string | null>): void {
  fs.mkdirSync(videosRoot(), { recursive: true });
  const file = ledgerPath();
  fs.writeFileSync(`${file}.part`, JSON.stringify(ledger, null, 1));
  fs.renameSync(`${file}.part`, file);
}
