import { after } from "next/server";
import { cloudClient } from "@/lib/cloud";
import { body, fail, json, withCoach } from "@/lib/coach-api";
import { flushPlanNotices, notePlanChanges, notifyNotes } from "@/lib/push";
import { applyPush, athleteData, pushNews, snapshot, type PushPayload } from "@/lib/sync-server";

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
        // The desktop app asks every few seconds while it's open: the moment to tell athletes
        // about plan changes the coach has since stopped making.
        after(() => flushPlanNotices(coach.id).catch((e) => console.error("[topset] plan notice", e)));
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
      const news = pushNews();
      const problem = await applyPush(client, coach.id, payload, news);
      if (problem) return fail(problem, 422);
      // Athletes hear about new notes once the desktop app has its answer; plan changes
      // wait until the coach has stopped editing (see `flushPlanNotices`).
      if (news.notes.length || news.plans.size) {
        after(async () => {
          await notifyNotes(coach.id, news.notes).catch((e) => console.error("[topset] push", e));
          await notePlanChanges(coach.id, news.plans).catch((e) => console.error("[topset] plan notice", e));
        });
      }
      return json({ ok: true });
    } finally {
      client.close();
    }
  });
}
