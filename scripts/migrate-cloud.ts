// Brings the Topset server's database up to this build's schema. Runs in the server's build
// (`npm run vercel-build`), before the new code goes live — one build at a time, so two
// servers never race to change the database.
import path from "node:path";
import { cloudClient, migrateRemote } from "../src/lib/cloud";

if (!process.env.TURSO_DATABASE_URL) {
  console.log("No TURSO_DATABASE_URL: nothing to migrate.");
  process.exit(0);
}

const client = cloudClient();
migrateRemote(client, path.join("prisma", "migrations"))
  .then((applied) => {
    console.log(applied.length ? `Migrated: ${applied.join(", ")}` : "Database is up to date.");
    client.close();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
