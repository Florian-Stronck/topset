import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The local `topset.db` for the desktop app, which syncs with the Topset server in the
 * background (see `sync.ts`), so every click stays local. The hosted server has no local
 * file and works on the Turso database directly.
 */
function createClient() {
  const turso = process.env.TURSO_DATABASE_URL;
  const adapter = turso
    ? new PrismaLibSql({ url: turso, authToken: process.env.TURSO_AUTH_TOKEN })
    : new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
