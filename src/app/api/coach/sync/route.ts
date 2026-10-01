import { after } from "next/server";
import { cloudClient } from "@/lib/cloud";
import { body, fail, json, withCoach } from "@/lib/coach-api";
import { knowsTeams, tooOld } from "@/lib/desktop-version";
import { flushPlanNotices, notePlanChanges, notifyMeetings, notifyNotes } from "@/lib/push";
import { accessData, applyPush, athleteData, planData, planRev, pushNews, snapshot, type PushPayload } from "@/lib/sync-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `?part=snapshot`: all of the coach's data. `?part=ids`: just its ids.
 * `?part=athlete`: what their athletes logged; `&since=<version>` skips it if nothing new.
 * `?part=plan&since=<rev>`: plan rows the coach's other computers changed since then.
 * `?part=access`: the coach's teams, and every athlete they may see.
 * `?part=athletes&ids=<a,b>`: everything under athletes just shared with the coach.
 * Snapshots carry the log's `rev` as of just before they were read.
 *
 * A desktop app too old for teams gets only the coach's own athletes, as it always did.
 */
export async function GET(request: Request) {
  return withCoach(request, async (coach) => {
    const old = tooOld(request);
    if (old) return fail(old, 426);
    const params = new URL(request.url).searchParams;
    const part = params.get("part");
    const shared = knowsTeams(request);
    const client = cloudClient();
    try {
      if (part === "athlete") {
        // The desktop app asks every few seconds while it's open: the moment to tell athletes
        // about plan changes the coach has since stopped making.
        after(() => flushPlanNotices(coach.id).catch((e) => console.error("[topset] plan notice", e)));
        const since = Number(params.get("since") ?? NaN);
        return json({ ok: true, ...(await athleteData(client, coach.id, Number.isInteger(since) ? since : undefined, shared)) });
      }
      if (part === "plan") {
        const since = Number(params.get("since") ?? NaN);
        if (!Number.isInteger(since) || since < 0) return fail("Plan pulls need a since.");
        return json({ ok: true, ...(await planData(client, coach.id, coach.sessionId, since, undefined, shared)) });
      }
      // Only for apps that know teams; to anything older these parts don't exist.
      if ((part === "access" || part === "athletes") && !shared) return fail("Unknown part.");
      if (part === "access") return json({ ok: true, ...(await accessData(client, coach.id)) });
      if (part === "athletes") {
        const ids = (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 200);
        const rev = await planRev(client);
        return json({ ok: true, rev, tables: await snapshot(client, coach.id, false, true, ids) });
      }
      if (part === "snapshot" || part === "ids") {
        const rev = await planRev(client);
        // A take-over (`ids`) deletes from the server what the computer doesn't have: only
        // ever the coach's own, never a teammate's athlete it hasn't pulled yet.
        return json({ ok: true, rev, tables: await snapshot(client, coach.id, part === "ids", part === "snapshot" && shared) });
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
    const old = tooOld(request);
    if (old) return fail(old, 426);
    const payload = await body<PushPayload>(request);
    if (!payload) return fail("That push is too large or not JSON.", 413);
    const client = cloudClient();
    try {
      const news = pushNews();
      const problem = await applyPush(client, coach.id, payload, news, coach.sessionId);
      if (problem) return fail(problem, 422);
      // Athletes hear about new notes and meetings once the desktop app has its answer; plan changes
      // wait until the coach has stopped editing (see `flushPlanNotices`).
      if (news.notes.length || news.plans.size || news.meetings.length) {
        after(async () => {
          await notifyNotes(news.notes).catch((e) => console.error("[topset] push", e));
          await notifyMeetings(news.meetings).catch((e) => console.error("[topset] push", e));
          await notePlanChanges(coach.id, news.plans).catch((e) => console.error("[topset] plan notice", e));
        });
      }
      return json({ ok: true });
    } finally {
      client.close();
    }
  });
}
