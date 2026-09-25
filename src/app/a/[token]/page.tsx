import { notFound } from "next/navigation";
import { BodyweightCard } from "@/components/athlete/BodyweightCard";
import { CheckinDay, type StripDay } from "@/components/athlete/CheckinDay";
import { ReadinessCard } from "@/components/athlete/ReadinessCard";
import { getAthleteByToken, getAthleteCalendar, readinessOn, recentBodyweight, sessionsInFull, type ScheduledSession, type SchedulePhase } from "@/lib/athlete-queries";
import { longDate, shortDate, weekdayLetter, weekdayShort } from "@/lib/athlete-format";
import { athleteToday } from "@/lib/athlete-today";
import { loadSettings } from "@/lib/coach-settings";
import { ymdOf } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { dateOfDay, daysBetween } from "@/lib/schedule";
import { asksOn, parseDays } from "@/lib/readiness";
import { completion } from "@/lib/setlog";

export const dynamic = "force-dynamic";

/** Which week of a phase a date falls in, or null when it's outside the phase. */
function weekOf(phase: SchedulePhase, ymd: string): number | null {
  const offset = daysBetween(ymdOf(phase.startDate), ymd);
  if (offset < 0 || offset >= phase.weeks.length * 7) return null;
  return Math.floor(offset / 7) + 1;
}

/**
 * A day of the plan — today unless another was picked — inside its phase and week: the
 * phase and week to step through, the week's seven days, and the session to log.
 */
export default async function AthleteToday({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const [{ token }, { d }] = await Promise.all([params, searchParams]);
  const athlete = await getAthleteByToken(token);
  if (!athlete) notFound();
  await loadSettings(athlete.coachId);

  const today = await athleteToday();
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  // Readiness is asked on the coach's weekdays, for today or a day already past.
  const asked = day <= today && asksOn(parseDays(athlete.readinessDays), day);
  const [{ phases, sessions }, bodyweight, readiness] = await Promise.all([
    getAthleteCalendar(athlete),
    recentBodyweight(athlete.id),
    asked ? readinessOn(athlete.id, day) : null,
  ]);
  const base = `/a/${token}`;
  const link = (ymd: string) => (ymd === today ? base : `${base}?d=${ymd}`);

  const scheduled = sessions.find((s) => s.ymd === day) ?? null;
  // The phase the day belongs to: the one it is a session of, else the latest one running
  // on it, else the nearest one with something planned.
  const running = phases.filter((p) => weekOf(p, day) !== null);
  const nearest =
    sessions.find((s) => s.ymd > day) ?? [...sessions].reverse().find((s) => s.ymd < day) ?? null;
  const phase = scheduled?.block ?? running[running.length - 1] ?? nearest?.block ?? null;

  if (!phase) {
    return (
      <>
        <BodyweightCard token={token} unit={athlete.unit} day={today} today={today} entries={bodyweight} />
        {asked && <ReadinessCard token={token} day={day} initial={readiness} />}
        <div className="mt-12 rounded-2xl border border-border bg-surface px-5 py-8 text-center">
          <div className="text-[16px] font-medium">{t("No program yet")}</div>
          <p className="mt-1 text-[13px] text-muted">{t("Your coach hasn't written a program for you yet.")}</p>
        </div>
      </>
    );
  }

  const week = scheduled?.week ?? weekOf(phase, day) ?? (nearest?.block.id === phase.id ? nearest.week : 1);
  const inPhase = (s: ScheduledSession) => s.block.id === phase.id;
  const firstOf = (w: number) =>
    sessions.find((s) => inPhase(s) && s.week === w)?.ymd ?? dateOfDay(phase.startDate, w, 0);

  // Phases are stepped through in date order, whichever program they belong to.
  const at = phases.findIndex((p) => p.id === phase.id);
  const phaseHref = (p: SchedulePhase | undefined) =>
    p ? link(sessions.find((s) => s.block.id === p.id)?.ymd ?? ymdOf(p.startDate)) : null;

  const weekSessions = sessions.filter((s) => inPhase(s) && s.week === week);
  const shown = [...weekSessions];
  if (scheduled && !shown.includes(scheduled)) shown.push(scheduled);
  const full = await sessionsInFull(athlete, shown);
  const session = scheduled ? (full.find((s) => s.ymd === scheduled.ymd) ?? null) : null;
  const status = new Map(full.map((s) => [s.ymd, completion(s.done, s.prescribed)]));

  const strip: StripDay[] = Array.from({ length: 7 }, (_, i) => {
    const ymd = dateOfDay(phase.startDate, week, i);
    const on = weekSessions.find((s) => s.ymd === ymd);
    return {
      ymd,
      letter: weekdayLetter(ymd),
      title: on ? `${shortDate(ymd)} · ${on.day.label}` : shortDate(ymd),
      href: link(ymd),
      training: Boolean(on),
      status: status.get(ymd) ?? "none",
    };
  });

  const next = sessions.find((s) => s.ymd > day) ?? null;

  return (
    <CheckinDay
      key={day}
      token={token}
      unit={athlete.unit}
      today={today}
      day={day}
      athlete={athlete.name}
      program={phase.program.name}
      phase={{
        name: phase.phase,
        prev: phaseHref(phases[at - 1]),
        next: phaseHref(phases[at + 1]),
      }}
      week={{
        n: week,
        of: phase.weeks.length,
        prev: week > 1 ? link(firstOf(week - 1)) : null,
        next: week < phase.weeks.length ? link(firstOf(week + 1)) : null,
      }}
      strip={strip}
      heading={{ weekday: weekdayShort(day), label: session?.label ?? null, long: longDate(day) }}
      session={session}
      rest={{
        next: next ? { href: link(next.ymd), date: shortDate(next.ymd) } : null,
        todayHref: day === today ? null : base,
      }}
      bodyweight={bodyweight}
      readiness={asked ? { entry: readiness } : undefined}
    />
  );
}
