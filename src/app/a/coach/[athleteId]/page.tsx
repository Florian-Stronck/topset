import Link from "next/link";
import { redirect } from "next/navigation";
import { athletePage } from "@/app/a/coach/[athleteId]/athlete";
import { Heading } from "@/app/a/coach/parts";
import { latestReadiness } from "@/lib/checkins";
import { formatDate, today as calendarToday, weekdayOf, weekStartOf, ymdOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { startOfDay } from "@/lib/overview";
import { chatSummary, getAllPhasesForAthlete, getCheckins, getMoveMap, getNextMeets } from "@/lib/queries";
import { addDays, daysBetween, sessionsOf } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Where the views of the old one-page athlete screen went, for links and bookmarks from before. */
const MOVED: Record<string, string> = {
  review: "training",
  plan: "training?view=plan",
  progress: "body",
  wellness: "body?view=wellness",
  schedule: "schedule",
  meet: "meet",
  profile: "profile",
};

const card = "rounded-2xl border border-border bg-surface p-4";

/** One athlete at a glance: today's session, the week, their maxes and the next meet. */
export default async function AthleteOverview({
  params,
  searchParams,
}: {
  params: Promise<{ athleteId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { athleteId } = await params;
  const { view } = await searchParams;
  if (view === "chat") redirect(`/a/coach/chats?athlete=${athleteId}`);
  if (view && MOVED[view]) redirect(`/a/coach/${athleteId}/${MOVED[view]}`);

  const page = await athletePage(athleteId);
  if (!page) return null;
  const { athlete, unit } = page;
  const today = ymdOf(calendarToday());
  const [phases, moveMap, checkinMap, meets, chats] = await Promise.all([
    getAllPhasesForAthlete(athlete.id),
    getMoveMap([athlete.id]),
    getCheckins([athlete.id]),
    getNextMeets([athlete.id], startOfDay(new Date())),
    chatSummary([athlete.id]),
  ]);
  type Phase = (typeof phases)[number];
  const sessions = sessionsOf<Phase["weeks"][number]["days"][number], Phase>(phases, moveMap, athlete.activeProgramId).filter((s) => !s.day.rest && s.day.rows.some((r) => r.exercise.trim() !== ""));
  const done = (s: (typeof sessions)[number]) => s.day.rows.some((r) => r.actualWeight !== null);
  const todays = sessions.find((s) => s.ymd === today);
  const start = weekStartOf(today, activeSettings().weekStart);
  const week = Array.from({ length: 7 }, (_, i) => {
    const ymd = addDays(start, i);
    const s = sessions.find((x) => x.ymd === ymd);
    const status = !s ? "rest" : done(s) ? "done" : ymd < today ? "missed" : "plan";
    return { ymd, status, today: ymd === today };
  });
  const checkins = checkinMap.get(athlete.id);
  const readiness = checkins ? latestReadiness(checkins.questions, checkins.answers) : null;
  const meet = meets.get(athlete.id);
  const unread = chats.get(athlete.id)?.unread ?? 0;
  const base = `/a/coach/${athlete.id}`;

  const DOT: Record<string, string> = {
    done: "border-ok/50 bg-ok/15 text-ok",
    missed: "border-miss/50 bg-miss/15 text-miss",
    plan: "border-muted-2 text-foreground",
    rest: "border-transparent text-muted-2",
  };

  return (
    <div className="mt-4 flex flex-col gap-3">
      {unread > 0 && (
        <Link href={`/a/coach/chats?athlete=${athlete.id}`} className="flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-[14px] text-accent">
          <span className="grid size-6 place-items-center rounded-full bg-accent text-[12px] font-bold text-white">{unread}</span>
          {t("New messages from {name}", { name: athlete.name })}
        </Link>
      )}

      <Link href={`${base}/training`} className={`${card} flex flex-col gap-2`}>
        <span className="flex items-center justify-between">
          <Heading>{t("TODAY")}</Heading>
          {todays && done(todays) && !todays.day.reviewedAt && (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent">{t("to review")}</span>
          )}
        </span>
        {todays ? (
          <>
            <span className="text-[18px] font-semibold">{todays.day.label}</span>
            <span className="text-[13px] text-muted">
              {t("{done}/{of} exercises", {
                done: todays.day.rows.filter((r) => r.actualWeight !== null).length,
                of: todays.day.rows.filter((r) => r.exercise.trim() !== "").length,
              })}
            </span>
          </>
        ) : (
          <span className="text-[15px] text-muted">{t("No session today.")}</span>
        )}
        {readiness?.score != null && (
          <span className={`w-fit rounded-full px-2.5 py-1 text-[12px] ${readiness.score <= 2 ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted"}`}>
            {t("Readiness {n}/5", { n: readiness.score })} · {formatDate(readiness.day)}
          </span>
        )}
      </Link>

      <section className={`${card} flex flex-col gap-3`}>
        <Heading>{t("THIS WEEK")}</Heading>
        <div className="grid grid-cols-7 gap-1 text-center">
          {week.map((d) => (
            <Link key={d.ymd} href={`${base}/training`} className="flex flex-col items-center gap-1.5">
              <span className="text-[11px] text-muted">{weekdayShort(weekdayOf(d.ymd)).slice(0, 2)}</span>
              <span
                className={`grid size-9 place-items-center rounded-full border text-[12px] font-semibold ${d.today ? "border-foreground bg-foreground text-background" : DOT[d.status]}`}
                aria-label={`${formatDate(d.ymd)} · ${t(d.status === "done" ? "done" : d.status === "missed" ? "missed" : d.status === "plan" ? "planned" : "Rest")}`}
              >
                {Number(d.ymd.slice(8, 10))}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {(
          [
            ["Squat", athlete.squat1RM],
            ["Bench", athlete.bench1RM],
            ["Deadlift", athlete.dead1RM],
          ] as const
        ).map(([lift, max]) => (
          <Link key={lift} href={`${base}/body`} className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-3">
            <span className="text-[12px] text-muted">{t(lift)}</span>
            <span className="text-[20px] font-bold tabular-nums">{max ?? "—"}</span>
            <span className="text-[11px] text-muted-2">{unit}</span>
          </Link>
        ))}
      </section>

      {meet && (
        <Link href={`${base}/meet`} className={`${card} flex items-center gap-3`}>
          <span className="text-[28px] font-bold tabular-nums text-accent">{daysBetween(today, ymdOf(meet.date))}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{meet.name}</span>
            <span className="block text-[12px] text-muted">
              {[t("days out"), meet.weightClass].filter(Boolean).join(" · ")}
            </span>
          </span>
        </Link>
      )}
    </div>
  );
}
