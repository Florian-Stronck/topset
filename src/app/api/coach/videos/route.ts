import { cloudClient } from "@/lib/cloud";
import { ownedIdsSql } from "@/lib/coach-scope";
import { body, fail, json, withCoach } from "@/lib/coach-api";
import { presign, storageConfig } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** How long a download link works: long enough for a big file on a slow line. */
const DOWNLOAD_LINK_SECONDS = 60 * 60;
const MAX_IDS = 100;

/**
 * Download links for videos the coach's athletes sent, for their desktop app to keep a
 * copy: `{ ids }` in, `{ urls: { id: link } }` out. Only the coach's own athletes' videos
 * that finished uploading and weren't taken back get one; the file's place in storage is
 * read from the server's row, never taken from the request.
 */
export async function POST(request: Request) {
  return withCoach(request, async (coach) => {
    const config = storageConfig();
    if (!config) return json({ ok: true, urls: {} });
    const payload = await body<{ ids?: unknown }>(request);
    const ids = Array.isArray(payload?.ids) ? payload.ids.filter((id): id is string => typeof id === "string").slice(0, MAX_IDS) : [];
    if (ids.length === 0) return fail("No videos asked for.");

    const client = cloudClient();
    try {
      const rs = await client.execute({
        sql:
          `SELECT "id", "storageKey" FROM "AthleteVideo" WHERE "id" IN (${ids.map(() => "?").join(", ")}) ` +
          `AND "uploadedAt" IS NOT NULL AND "deletedAt" IS NULL AND "id" IN (${ownedIdsSql("AthleteVideo")})`,
        args: [...ids, coach.id],
      });
      const urls: Record<string, string> = {};
      for (const row of rs.rows) {
        urls[String(row.id)] = presign(config, { method: "GET", key: String(row.storageKey), expiresIn: DOWNLOAD_LINK_SECONDS });
      }
      return json({ ok: true, urls });
    } finally {
      client.close();
    }
  });
}
