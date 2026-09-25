import path from "node:path";
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    // Generating the client needs no database; the hosted athlete app only has Turso.
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
});
