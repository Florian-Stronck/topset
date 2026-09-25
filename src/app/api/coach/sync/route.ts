import { cloudClient } from "@/lib/cloud";
import { body, fail, json, withCoach } from "@/lib/coach-api";
import { applyPush, athleteData, snapshot, type PushPayload } from "@/lib/sync-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `?part=snapshot`: all of the coach's data. `?part=ids`: just its ids.
 * `?part=athlete`: what their athletes logged; `&since=<version>` skips it if nothing new.
 */
export async function GET(request: Request) {
  return withCoach(request, async (coach) => {
    const params = new URL(request.url).searchParams;
    const part = params.get("part");
    const client = cloudClient();
    try {
      if (part === "athlete") {
        const since = Number(params.get("since") ?? NaN);
        return json({ ok: true, ...(await athleteData(client, coach.id, Number.isInteger(since) ? since : undefined)) });
      }
      if (part === "snapshot" || part === "ids") {
        return json({ ok: true, tables: await snapshot(client, coach.id, part === "ids") });
      }
      return fail("Unknown part.");
    } finally {
      client.close();
    }
  });
}

/** Changes from the coach's desktop app. */
export async function POST(request: Request) {
  return withCoach(request, async (coach) => {
    const payload = await body<PushPayload>(request);
    if (!payload) return fail("That push is too large or not JSON.", 413);
    const client = cloudClient();
    try {
      const problem = await applyPush(client, coach.id, payload);
      return problem ? fail(problem, 422) : json({ ok: true });
    } finally {
      client.close();
    }
  });
}
