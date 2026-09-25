import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/** The live database file, from the same URL Prisma connects with. */
export function databasePath(): string {
  const url = process.env.DATABASE_URL ?? "";
  // path.resolve already starts from the working directory; naming process.cwd() here
  // makes Next's file tracing copy the whole project into the standalone build.
  return path.resolve(url.replace(/^file:/, ""));
}

/** Where a restore waits until the desktop app next starts and swaps it in. */
export function stagedRestorePath(): string {
  return path.join(path.dirname(databasePath()), "topset-restore.db");
}

function tempFile() {
  return path.join(os.tmpdir(), `topset-${crypto.randomUUID()}.db`);
}

/** A consistent copy of the live database, taken while the app keeps running. */
export function snapshot(): Buffer {
  const out = tempFile();
  const db = new Database(databasePath(), { fileMustExist: true });
  try {
    db.prepare("VACUUM INTO ?").run(out);
  } finally {
    db.close();
  }
  try {
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

const REQUIRED_TABLES = ["Coach", "Athlete", "Program", "Block", "Week", "Day", "ExerciseRow"];

function localMigrations(): Set<string> {
  const live = new Database(databasePath(), { readonly: true, fileMustExist: true });
  try {
    return migrationsIn(live);
  } finally {
    live.close();
  }
}

function migrationsIn(db: Database.Database): Set<string> {
  return new Set(
    (
      db
        .prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)
        .all() as { migration_name: string }[]
    ).map((r) => r.migration_name),
  );
}

/**
 * Checks an uploaded file really is a Topset backup, then parks it beside the database. It is
 * never written over the live file here: the desktop app swaps it in on its next start,
 * before anything has the database open, and keeps a copy of what it replaced.
 */
export async function stageRestore(bytes: Buffer): Promise<{ ok: true; text?: string } | { ok: false; error: string }> {
  if (bytes.subarray(0, 16).toString("latin1") !== "SQLite format 3\0") {
    return { ok: false, error: "That isn't a Topset backup file." };
  }

  const tmp = tempFile();
  fs.writeFileSync(tmp, bytes);

  try {
    const backup = new Database(tmp, { readonly: true });
    try {
      const check = backup.pragma("quick_check", { simple: true });
      if (check !== "ok") return { ok: false, error: "The backup file is damaged." };

      const tables = new Set(
        (backup.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
          (t) => t.name,
        ),
      );
      if (!tables.has("_prisma_migrations") || REQUIRED_TABLES.some((t) => !tables.has(t))) {
        return { ok: false, error: "That isn't a Topset backup file." };
      }

      // A backup from a newer Topset has changes this version doesn't know how to read.
      const known = localMigrations();
      if ([...migrationsIn(backup)].some((m) => !known.has(m))) {
        return { ok: false, error: "That backup was made by a newer version of Topset. Update Topset first." };
      }
    } finally {
      backup.close();
    }

    fs.copyFileSync(tmp, stagedRestorePath());
    return { ok: true };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
