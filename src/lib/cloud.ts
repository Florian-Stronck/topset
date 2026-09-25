import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

/**
 * The Topset server's database (Turso). Only the hosted server talks to it; desktop apps
 * reach it through the server's coach API and never hold its key.
 */

/** Whether this is the hosted server, working on the Turso database directly. */
export function cloudPrimary(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

export function cloudClient(url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN): Client {
  if (!url) throw new Error("No cloud database is set up.");
  return createClient({ url, authToken });
}

/**
 * Applies any migration the database has not seen, the way `electron/migrate.js` does for
 * a desktop app's file, with the same ledger table. Run by the server's build.
 */
export async function migrateRemote(client: Client, migrationsDir: string): Promise<string[]> {
  await client.execute(`
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
    (await client.execute(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)).rows.map(
      (r) => String(r.migration_name),
    ),
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
    await client.executeMultiple(sql);
    await client.execute({
      sql: `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
            VALUES (?, ?, ?, current_timestamp, current_timestamp, 1)`,
      args: [crypto.randomUUID(), crypto.createHash("sha256").update(sql).digest("hex"), name],
    });
  }
  return pending;
}
