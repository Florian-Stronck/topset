"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Applies any migration the database has not seen, in order, the way
 * `prisma migrate deploy` would. The packaged app has no Prisma CLI in it, but the
 * migrations are plain SQL and the ledger table is Prisma's own, so a database created
 * here is one `prisma migrate` still understands.
 */
function migrate(db, migrationsDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    )`);

  const done = new Set(
    db
      .prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)
      .all()
      .map((r) => r.migration_name),
  );

  const pending = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !done.has(e.name))
    .map((e) => e.name)
    .sort();

  for (const name of pending) {
    const file = path.join(migrationsDir, name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");

    db.exec(sql);
    db.prepare(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (?, ?, ?, current_timestamp, current_timestamp, 1)`,
    ).run(crypto.randomUUID(), crypto.createHash("sha256").update(sql).digest("hex"), name);
  }

  return pending;
}

/** A database with no coach in it has nothing any screen can open. */
function ensureCoach(db) {
  const { count } = db.prepare(`SELECT count(*) AS count FROM "Coach"`).get();
  if (count > 0) return false;

  db.prepare(`INSERT INTO "Coach" (id, username, name) VALUES (?, ?, ?)`).run(crypto.randomUUID(), "coach", "Coach");
  return true;
}

module.exports = { migrate, ensureCoach };
