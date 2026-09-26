import { dailyNotices, flushPlanNotices } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Once a morning (vercel.json, 05:00 UTC): training-day reminders, meets coming up, and any
 * plan change a coach left pending by closing the app. Vercel Cron calls it with the
 * server's `CRON_SECRET`; without one set, nobody can.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  await flushPlanNotices();
  const { sent } = await dailyNotices();
  return Response.json({ ok: true, sent });
}
