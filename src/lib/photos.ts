import fs from "node:fs";
import path from "node:path";
import { databasePath } from "@/lib/backup";

/**
 * Check-in photos, as the coach's desktop app keeps them: one JPEG per `CheckinPhoto` row,
 * named by its id, in a folder beside topset.db. Sync downloads them while storage still
 * has them (it lets go after a few weeks), so the copies here are the ones that last. A
 * photo storage had already let go of gets an empty `.gone` file, so it isn't asked for again.
 */

export function photosRoot(): string {
  return path.join(path.dirname(databasePath()), "topset-photos");
}

/** Ids are cuids; anything else could climb out of the folder. */
export const safePhotoId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export function photoFile(id: string): string {
  if (!safePhotoId(id)) throw new Error("Not a photo.");
  return path.join(photosRoot(), `${id}.jpg`);
}

/** Whether this computer has the photo, or knows it is gone for good. */
export function photoSettled(id: string): boolean {
  const file = photoFile(id);
  return fs.existsSync(file) || fs.existsSync(`${file}.gone`);
}

export function markPhotoGone(id: string): void {
  fs.mkdirSync(photosRoot(), { recursive: true });
  fs.writeFileSync(`${photoFile(id)}.gone`, "");
}

/** Of these ids, the ones with a copy here. */
export function photosHere(ids: string[]): Set<string> {
  return new Set(ids.filter((id) => safePhotoId(id) && fs.existsSync(photoFile(id))));
}
