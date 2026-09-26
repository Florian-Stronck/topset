import webpush from "web-push";
import { getAthleteSchedule, type TokenAthlete } from "@/lib/athlete-queries";
import { ymdOf } from "@/lib/dates";
import { tIn } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import type { PushKind } from "@/lib/push-kinds";
import { sessionOn } from "@/lib/schedule";
import { parseSettings, type Language } from "@/lib/settings";
import type { NewNote } from "@/lib/sync-server";

/**
 * Push notifications for the athlete app: the coach's notes and plan changes, the morning
 * of a training day, and a meet coming up — each only to the phones that asked for that
 * kind. Standard Web Push, signed with the server's VAPID keys (`TOPSET_VAPID_PUBLIC_KEY` /
 * `TOPSET_VAPID_PRIVATE_KEY`); without them the athlete app doesn't offer notifications and
 * nothing is sent.
 */

/** What a phone needs to sign up; null when this server has no keys. */
export function vapidPublicKey(): string | null {
  return process.env.TOPSET_VAPID_PUBLIC_KEY || null;
}

function configured(): boolean {
  const pub = vapidPublicKey();
  const priv = process.env.TOPSET_VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  // Push services want a way to reach whoever runs the server if it misbehaves.
  webpush.setVapidDetails(process.env.TOPSET_VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  return true;
}

/** What the service worker gets: enough to show the notification, and the icon's badge for notes. */
export type PushPayload = { title: string; body: string; url: string; tag: string; badge?: number };

type Sub = Awaited<ReturnType<typeof prisma.pushSubscription.findMany>>[number];

const PREVIEW = 140;

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW ? `${line.slice(0, PREVIEW - 1)}…` : line;
}

/**
 * The phones of one athlete that want this kind, signed up with their current link. Phones
 * on an old link are dropped on the way.
 */
async function phones(athleteId: string, token: string, kind: PushKind): Promise<Sub[]> {
  const subs = await prisma.pushSubscription.findMany({ where: { athleteId } });
  const stale = subs.filter((s) => s.token !== token).map((s) => s.id);
  if (stale.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: stale } } });
  return subs.filter((s) => s.token === token && s[kind]);
}

/** Sends one payload to these phones; one its push service says is gone is dropped. */
async function send(subs: Sub[], payload: PushPayload): Promise<void> {
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          TTL: 60 * 60 * 24,
          urgency: "normal",
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
        else console.error("[topset] push failed", status ?? error);
      }
    }),
  );
  if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
}

/** The coach behind some athletes: their name for the title, their language for the text. */
async function coachVoice(coachId: string): Promise<{ name: string; lang: Language } | null> {
  const coach = await prisma.coach.findUnique({ where: { id: coachId }, select: { name: true, settings: true, disabledAt: true } });
  if (!coach || coach.disabledAt) return null;
  const lang = parseSettings(coach.settings).language;
  return { name: coach.name.trim() || tIn(lang, "Your coach"), lang };
}

// --- the coach's notes ----------------------------------------------------------------------

/** Tells each athlete about the coach's new notes: one notification per note. */
export async function notifyNotes(coachId: string, notes: NewNote[]): Promise<void> {
  if (notes.length === 0 || !configured()) return;
  const voice = await coachVoice(coachId);
  if (!voice) return;
  const athleteIds = [...new Set(notes.map((n) => n.athleteId))];
  const athletes = await prisma.athlete.findMany({
    where: { id: { in: athleteIds }, coachId, accessToken: { not: null } },
    select: { id: true, accessToken: true },
  });
  const unread = await prisma.coachMessage.groupBy({
    by: ["athleteId"],
    where: { athleteId: { in: athleteIds }, deletedAt: null, readAt: null },
    _count: { _all: true },
  });
  const badge = new Map(unread.map((u) => [u.athleteId, u._count._all]));

  for (const a of athletes) {
    const token = a.accessToken!;
    const subs = await phones(a.id, token, "notes");
    if (subs.length === 0) continue;
    const theirs = notes.filter((n) => n.athleteId === a.id);
    for (const n of theirs) {
      await send(subs, {
        title: tIn(voice.lang, "{name} left you a note", { name: voice.name }),
        body: preview(n.body),
        url: `/a/${token}/inbox`,
        tag: `note-${n.id}`,
        badge: badge.get(a.id) ?? theirs.length,
      });
    }
  }
}

// --- plan changes -----------------------------------------------------------------------------

/** How long the coach has to have stopped editing a plan before the athlete hears. */
const PLAN_QUIET_MS = 5 * 60_000;
/** And at most this often, however the edits fall. */
const PLAN_EVERY_MS = 3 * 60 * 60_000;

/** Remembers that these athletes' plans changed; `flushPlanNotices` tells them later. */
export async function notePlanChanges(coachId: string, athleteIds: Iterable<string>): Promise<void> {
  const now = new Date();
  for (const athleteId of athleteIds) {
    await prisma.planNotice.upsert({
      where: { athleteId },
      create: { athleteId, coachId, changedAt: now },
      update: { coachId, changedAt: now },
    });
  }
}

/**
 * Tells athletes whose plan changed and has sat still since: one coach's (as their desktop
 * app polls), or everyone's (the daily run). Each notice is claimed before it is sent, so
 * two runs at once send it once.
 */
export async function flushPlanNotices(coachId?: string): Promise<void> {
  const now = Date.now();
  const due = await prisma.planNotice.findMany({
    where: {
      ...(coachId ? { coachId } : {}),
      changedAt: { not: null, lte: new Date(now - PLAN_QUIET_MS) },
      OR: [{ sentAt: null }, { sentAt: { lte: new Date(now - PLAN_EVERY_MS) } }],
    },
  });
  if (due.length === 0) return;
  const ready = configured();
  const voices = new Map<string, Awaited<ReturnType<typeof coachVoice>>>();

  for (const notice of due) {
    const { count } = await prisma.planNotice.updateMany({
      where: { athleteId: notice.athleteId, changedAt: notice.changedAt },
      data: { changedAt: null, sentAt: new Date(now) },
    });
    if (count === 0 || !ready) continue;
    const athlete = await prisma.athlete.findUnique({ where: { id: notice.athleteId }, select: { accessToken: true, coachId: true } });
    if (!athlete?.accessToken) continue;
    if (!voices.has(athlete.coachId)) voices.set(athlete.coachId, await coachVoice(athlete.coachId));
    const voice = voices.get(athlete.coachId);
    if (!voice) continue;
    const subs = await phones(notice.athleteId, athlete.accessToken, "plan");
    if (subs.length === 0) continue;
    await send(subs, {
      title: tIn(voice.lang, "{name} updated your plan", { name: voice.name }),
      body: tIn(voice.lang, "Open the app to see what's new."),
      url: `/a/${athlete.accessToken}`,
      tag: "plan",
    });
  }
}

// --- the daily run: training today, meets coming up ------------------------------------------

/** Today on a phone's calendar. */
function todayIn(timeZone: string | null, now: Date): string {
  try {
    if (timeZone) return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {}
  return now.toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days before a meet the athlete hears about it. */
const MEET_NOTICES = [7, 1];

/**
 * Once a morning: each phone that wants it hears whether today is a training day, and about
 * a meet a week or a day away. Days are the phone's own, from its time zone.
 */
export async function dailyNotices(now = new Date()): Promise<{ sent: number }> {
  if (!configured()) return { sent: 0 };
  let sent = 0;
  const subs = await prisma.pushSubscription.findMany({ where: { OR: [{ reminder: true }, { meets: true }] } });
  const byAthlete = new Map<string, Sub[]>();
  for (const s of subs) byAthlete.set(s.athleteId, [...(byAthlete.get(s.athleteId) ?? []), s]);

  for (const [athleteId, theirs] of byAthlete) {
    const athlete = await prisma.athlete.findUnique({
      where: { id: athleteId },
      select: { id: true, coachId: true, name: true, unit: true, squat1RM: true, bench1RM: true, dead1RM: true, accessToken: true },
    });
    if (!athlete?.accessToken) continue;
    const token = athlete.accessToken;
    const live = theirs.filter((s) => s.token === token);
    if (live.length === 0) continue;
    const voice = await coachVoice(athlete.coachId);
    if (!voice) continue;

    const reminders = live.filter((s) => s.reminder);
    if (reminders.length) {
      const schedule = await getAthleteSchedule(athlete as TokenAthlete);
      for (const s of reminders) {
        const today = todayIn(s.timeZone, now);
        const session = sessionOn(schedule, today);
        if (!session) continue;
        const planned = await prisma.exerciseRow.count({ where: { dayId: session.day.id, exercise: { not: "" } } });
        if (planned === 0) continue;
        await send([s], {
          title: tIn(voice.lang, "Training today: {label}", { label: session.day.label }),
          body: tIn(voice.lang, "{program}, week {n}. Tap to see your session.", { program: session.block.program.name, n: session.week }),
          url: `/a/${token}`,
          tag: `today-${today}`,
        });
        sent++;
      }
    }

    const meetPhones = live.filter((s) => s.meets);
    if (meetPhones.length) {
      const meets = await prisma.meet.findMany({ where: { athleteId }, select: { id: true, name: true, date: true } });
      for (const s of meetPhones) {
        const today = todayIn(s.timeZone, now);
        for (const meet of meets) {
          const days = MEET_NOTICES.find((n) => addDays(today, n) === ymdOf(meet.date));
          if (!days) continue;
          await send([s], {
            title: days === 1 ? tIn(voice.lang, "{meet} is tomorrow", { meet: meet.name }) : tIn(voice.lang, "{meet} is in {n} days", { meet: meet.name, n: days }),
            body: days === 1 ? tIn(voice.lang, "Rest up and check your attempts.") : tIn(voice.lang, "One week to go. Trust the plan."),
            url: `/a/${token}`,
            tag: `meet-${meet.id}-${days}`,
          });
          sent++;
        }
      }
    }
  }
  return { sent };
}
