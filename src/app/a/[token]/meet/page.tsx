import Link from "next/link";
import { notFound } from "next/navigation";
import { MeetTasks } from "@/components/athlete/MeetCards";
import { longDate, meetTimes, weekdayShort } from "@/lib/athlete-format";
import { getAthleteByToken, nextMeetFor, recentBodyweight } from "@/lib/athlete-queries";
import { athleteToday } from "@/lib/athlete-today";
import { bodyweightSummary, classLimit, dailyWeights, projectWeight, rollingAverage } from "@/lib/bodyweight";
import { loadSettings } from "@/lib/coach-settings";
import { LIFT_LABEL, MEET_LIFTS } from "@/lib/competition";
import { t } from "@/lib/i18n";
import { addDays, daysBetween } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** How far back the weight line looks. */
const WEIGHT_DAYS = 56;

/** The next meet, all of it: when and where, the attempts, rack heights, making weight, and the list. */
export default async function AthleteMeet({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const athlete = await getAthleteByToken(token);
  if (!athlete) notFound();
  await loadSettings(athlete.coachId);
  const today = await athleteToday();
  const [meet, weighIns] = await Promise.all([nextMeetFor(athlete.id, today), recentBodyweight(athlete.id, 90)]);
  const back = (
    <Link href={`/a/${token}`} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-[14px] text-muted">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m15 6-6 6 6 6" />
      </svg>
      {t("Today")}
    </Link>
  );
  if (!meet) {
    return (
      <>
        {back}
        <div className="mt-6 rounded-2xl border border-border bg-surface px-5 py-8 text-center text-[14px] text-muted">{t("No meet coming up.")}</div>
      </>
    );
  }

  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const days = daysBetween(today, meet.ymd);
  const daily = dailyWeights([...weighIns].reverse());
  const summary = bodyweightSummary(daily, today);
  const current = summary.avg7 ?? summary.latest?.weight ?? null;
  const limit = classLimit(meet.weightClass);
  const projected = projectWeight(daily, today, meet.weighInDay)?.weight ?? null;
  const line = rollingAverage(daily).filter((d) => d.day >= addDays(today, -WEIGHT_DAYS) && d.day <= today);
  const racks = [
    { k: t("Squat"), v: meet.racks.squat },
    { k: t("Bench"), v: meet.racks.bench },
    { k: t("Safeties"), v: meet.racks.safety },
  ].filter((r) => r.v);
  const facts = [
    { k: t("Date"), v: longDate(meet.ymd), sub: "" },
    meet.weighInTime && {
      k: t("Weigh-in"),
      v: meet.weighInDay === meet.ymd ? meet.weighInTime : `${weekdayShort(meet.weighInDay)} ${meet.weighInTime}`,
      sub: meet.weighInDay === meet.ymd ? "" : t("The day before"),
    },
    (meet.session || meet.startTime) && { k: t("Lifting"), v: meet.session ?? meet.startTime ?? "", sub: meet.session && meet.startTime ? t("From {time}", { time: meet.startTime }) : "" },
    meet.venue && { k: t("Venue"), v: meet.venue, sub: "" },
  ].filter((f): f is { k: string; v: string; sub: string } => Boolean(f));
  const card = "rounded-2xl border border-border bg-surface";
  const heading = "text-[11px] font-semibold tracking-[0.14em] text-muted";

  return (
    <div className="space-y-3.5">
      {back}
      <header>
        <div className="text-[12px] text-muted">{[meet.federation, meet.weightClass].filter(Boolean).join(" · ")}</div>
        <h1 className="text-[24px] font-bold tracking-tight">{meet.name}</h1>
        <div className="mt-2 flex items-baseline gap-2">
          {days === 0 ? (
            <span className="text-[28px] font-bold text-accent">{t("Meet day")}</span>
          ) : (
            <>
              <span className="text-[44px] font-bold leading-none text-accent">{days}</span>
              <span className="text-[15px] text-muted">{t(days === 1 ? "day to go" : "days to go")}</span>
            </>
          )}
        </div>
        {meetTimes(meet) && <div className="mt-1 text-[13px] text-muted">{meetTimes(meet)}</div>}
      </header>

      <section aria-label={t("When and where")} className={`${card} divide-y divide-border px-4`}>
        {facts.map((f) => (
          <div key={f.k} className="flex gap-3 py-2.5 text-[14px]">
            <span className="w-20 shrink-0 text-muted">{f.k}</span>
            <span className="flex-1">
              {f.v}
              {f.sub && <span className="block text-[12px] text-muted">{f.sub}</span>}
            </span>
          </div>
        ))}
      </section>

      {meet.attempts && (
        <section className={`${card} space-y-2 p-4`}>
          <h2 className={heading}>{t("YOUR ATTEMPTS")}</h2>
          <div className="grid grid-cols-[72px_repeat(3,minmax(0,1fr))] gap-1.5 text-center text-[11px] text-muted">
            <span />
            <span>{t("Opener")}</span>
            <span>{t("Second")}</span>
            <span>{t("Third")}</span>
          </div>
          {MEET_LIFTS.map((lift) => (
            <div key={lift} className="grid grid-cols-[72px_repeat(3,minmax(0,1fr))] items-center gap-1.5">
              <span className="text-[13px] font-medium">{t(LIFT_LABEL[lift])}</span>
              {[1, 2, 3].map((n) => {
                const w = meet.attempts?.find((a) => a.lift === lift && a.number === n)?.weight ?? null;
                return (
                  <span key={n} className={`rounded-xl py-2.5 text-center font-semibold tabular-nums ${n === 1 ? "bg-accent-soft text-[16px] text-accent" : "bg-surface-2 text-[15px]"}`}>
                    {w ?? "—"}
                  </span>
                );
              })}
            </div>
          ))}
          <p className="text-[12px] text-muted">{t("Seconds and thirds can change on the day. Your coach calls them.")}</p>
        </section>
      )}

      {racks.length > 0 && (
        <section className={`${card} space-y-2 p-4`}>
          <h2 className={heading}>
            {t("RACK HEIGHTS")}
            {meet.rackBrand && ` · ${meet.rackBrand.toUpperCase()}`}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {racks.map((r) => (
              <div key={r.k} className="rounded-xl bg-surface-2 px-3 py-2.5">
                <div className="text-[12px] text-muted">{r.k}</div>
                <div className="text-[26px] font-bold">{r.v}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {current !== null && (
        <section className={`${card} space-y-1.5 p-4`}>
          <div className="flex items-baseline justify-between">
            <h2 className={heading}>{limit !== null ? t("MAKING {n}", { n: limit }) : t("BODYWEIGHT")}</h2>
            {limit !== null && <span className={`text-[12px] ${(projected ?? current) > limit ? "text-warn" : "text-ok"}`}>{(projected ?? current) > limit ? t("over the class") : t("on track")}</span>}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[26px] font-bold">{current}</span>
            <span className="text-[13px] text-muted">{t("{u}, 7-day average", { u: unit })}</span>
          </div>
          {line.length > 1 && <WeightLine points={line.map((d) => d.weight)} limit={limit} />}
          <p className="text-[13px] text-muted">
            {[
              limit !== null &&
                t(current > limit ? "{n} {u} over the class." : "{n} {u} under the class.", { n: Math.round(Math.abs(current - limit) * 10) / 10, u: unit }),
              projected !== null && t("On this trend about {w} at weigh-in.", { w: projected }),
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        </section>
      )}

      <MeetTasks token={token} tasks={meet.tasks} />

      <Link href={`/a/${token}/inbox`} className={`${card} flex min-h-[52px] items-center gap-3 px-4`}>
        <svg className="shrink-0 text-muted" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span className="flex-1">
          <span className="block text-[14px]">{t("Meet reminders")}</span>
          <span className="block text-[12px] text-muted">{t("Turn them on with the bell in Chat")}</span>
        </span>
      </Link>
    </div>
  );
}

/** The 7-day average as a line, with the class limit dashed across it. */
function WeightLine({ points, limit }: { points: number[]; limit: number | null }) {
  const all = limit !== null ? [...points, limit] : points;
  const lo = Math.min(...all) - 0.3;
  const hi = Math.max(...all) + 0.3;
  const x = (i: number) => (i / (points.length - 1)) * 300;
  const y = (v: number) => 64 - ((v - lo) / (hi - lo)) * 58;
  return (
    <svg viewBox="0 0 300 70" preserveAspectRatio="none" className="h-16 w-full" aria-hidden>
      {limit !== null && <line x1={0} x2={300} y1={y(limit)} y2={y(limit)} stroke="var(--warn)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      <polyline points={points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
