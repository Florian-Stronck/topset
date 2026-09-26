import Link from "next/link";
import { notFound } from "next/navigation";
import { HistoryCalendar, type CalendarCell } from "@/components/athlete/HistoryCalendar";
import { Trophy } from "@/components/CheckinIcon";
import {
  getAthleteByToken,
  getAthleteSchedule,
  inboxFor,
  meetsFor,
  sessionsInFull,
  type AthleteMeet,
  type AthleteSession,
  type InboxMessage,
} from "@/lib/athlete-queries";
import { longDate } from "@/lib/athlete-format";
import { athleteToday } from "@/lib/athlete-today";
import { dayKind, monthGrid, parseMonth, shiftMonth } from "@/lib/calendar";
import { loadSettings } from "@/lib/coach-settings";
import { LOCALE, plural, t, weekdayShort } from "@/lib/i18n";
import { completion, formatSet } from "@/lib/setlog";

export const dynamic = "force-dynamic";

/**
 * A month of training as a calendar: white for sessions to come, red for sessions done,
 * yellow for a day with a PR, green for a competition. Tapping a day shows what was
 * planned and logged on it. Only the month on screen is read in full.
 */
export default async function AthleteHistory({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ m?: string; day?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const athlete = await getAthleteByToken(token);
  if (!athlete) notFound();
  const settings = await loadSettings(athlete.coachId);

  const today = await athleteToday();
  const current = today.slice(0, 7);
  const month = parseMonth(query.m) ?? current;
  const weeks = monthGrid(month, settings.weekStart);
  const first = weeks[0][0].ymd;
  const last = weeks[weeks.length - 1][6].ymd;

  const [schedule, meets] = await Promise.all([getAthleteSchedule(athlete), meetsFor(athlete.id)]);
  // The whole grid, so the days showing from either side of the month are coloured too.
  const shown = await sessionsInFull(
    athlete,
    schedule.filter((s) => s.ymd >= first && s.ymd <= last),
  );
  const notes = await inboxFor(athlete.id, shown.map((s) => s.ymd));
  const sessionOn = new Map(shown.map((s) => [s.ymd, s]));
  const meetsOn = new Map<string, AthleteMeet[]>();
  for (const m of meets) if (m.ymd >= first && m.ymd <= last) meetsOn.set(m.ymd, [...(meetsOn.get(m.ymd) ?? []), m]);
  const u = athlete.unit === "LB" ? "lb" : "kg";
  const base = `/a/${token}`;

  const cells: CalendarCell[][] = weeks.map((week) =>
    week.map(({ ymd, inMonth }) => {
      const s = sessionOn.get(ymd) ?? null;
      return {
        ymd,
        inMonth,
        day: Number(ymd.slice(8)),
        kind: dayKind(ymd, today, {
          meet: meetsOn.has(ymd),
          session: s ? { done: s.done, prescribed: s.prescribed, pr: s.rows.some((r) => r.logs.some((l) => l.pr)) } : null,
        }),
      };
    }),
  );

  const details: Record<string, React.ReactNode> = {};
  for (const ymd of new Set([...sessionOn.keys(), ...meetsOn.keys()])) {
    const s = sessionOn.get(ymd);
    details[ymd] = (
      <div className="space-y-2">
        <h3 className="text-[11px] tracking-[0.16em] text-muted-2">{longDate(ymd).toUpperCase()}</h3>
        {(meetsOn.get(ymd) ?? []).map((m) => (
          <MeetItem key={m.id} meet={m} unit={u} />
        ))}
        {s && (
          <SessionItem
            session={s}
            href={ymd === today ? base : `${base}?d=${ymd}`}
            unit={u}
            upcoming={ymd > today}
            today={ymd === today}
            notes={notes.filter((n) => n.day === ymd)}
          />
        )}
      </div>
    );
  }

  const inMonth = shown.filter((s) => s.ymd.startsWith(month));
  const past = inMonth.filter((s) => s.ymd <= today);
  const done = past.filter((s) => completion(s.done, s.prescribed) !== "none").length;
  const prs = inMonth.filter((s) => s.rows.some((r) => r.logs.some((l) => l.pr))).length;
  const title = new Date(`${month}-15T12:00:00Z`).toLocaleDateString(LOCALE[settings.language], {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const link = (m: string, day?: string) => `${base}/history?m=${m}${day ? `&day=${day}` : ""}`;
  const picked = query.day && /^\d{4}-\d{2}-\d{2}$/.test(query.day) ? query.day : null;

  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-tight">{t("History")}</h1>
      <p className="mt-1 text-[13px] text-muted">
        {past.length > 0
          ? t("{done} of {of} sessions done this month", { done, of: past.length })
          : inMonth.length > 0
            ? plural(inMonth.length, "{n} session planned this month", "{n} sessions planned this month")
            : t("Nothing planned this month.")}
        {prs > 0 && <> · {plural(prs, "{n} PR day", "{n} PR days")}</>}
      </p>

      {/* A new month starts from its own selection. */}
      <HistoryCalendar
        key={month}
        title={title}
        prev={link(shiftMonth(month, -1))}
        next={link(shiftMonth(month, 1))}
        thisMonth={month === current ? null : link(current, today)}
        weekdays={Array.from({ length: 7 }, (_, i) => weekdayShort((settings.weekStart + i) % 7))}
        weeks={cells}
        today={today}
        initial={picked ?? (month === current ? today : null)}
        details={details}
        empty={t("Nothing planned that day.")}
      />
    </div>
  );
}

const LIFT_ORDER = { SQUAT: 0, BENCH: 1, DEADLIFT: 2 } as const;
const LIFT_NAME = { SQUAT: "Squat", BENCH: "Bench", DEADLIFT: "Deadlift" } as const;

/** A competition on the calendar: where, and the attempts as they stand. */
function MeetItem({ meet, unit }: { meet: AthleteMeet; unit: string }) {
  const lifts = (["SQUAT", "BENCH", "DEADLIFT"] as const)
    .map((lift) => ({ lift, attempts: meet.attempts.filter((a) => a.lift === lift).sort((a, b) => a.number - b.number) }))
    .filter((l) => l.attempts.some((a) => a.weight !== null))
    .sort((a, b) => LIFT_ORDER[a.lift] - LIFT_ORDER[b.lift]);
  return (
    <div className="rounded-2xl border border-cal-meet/50 bg-cal-meet/10 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[14px] font-semibold">
          <Trophy size={14} className="text-cal-meet" />
          {meet.name}
        </span>
        <span className="shrink-0 rounded-full bg-cal-meet px-2 py-0.5 text-[11px] font-medium text-black">{t("Competition")}</span>
      </div>
      {(meet.federation || meet.weightClass) && (
        <div className="mt-0.5 text-[12px] text-muted-2">{[meet.federation, meet.weightClass].filter(Boolean).join(" · ")}</div>
      )}
      {lifts.length > 0 && (
        <ul className="mt-2 space-y-1">
          {lifts.map(({ lift, attempts }) => (
            <li key={lift} className="flex justify-between gap-2 text-[13px]">
              <span>{t(LIFT_NAME[lift])}</span>
              <span className="flex gap-1">
                {attempts.map((a) => (
                  <span
                    key={a.number}
                    className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums ${
                      a.result === "GOOD" ? "bg-ok/20 text-ok" : a.result === "MISS" ? "bg-miss/15 text-miss line-through" : "bg-surface-3 text-muted"
                    }`}
                  >
                    {a.weight ?? "—"}
                  </span>
                ))}
                <span className="text-[11px] text-muted-2">{unit}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionItem({
  session,
  href,
  unit,
  upcoming = false,
  today = false,
  notes = [],
}: {
  session: AthleteSession;
  href: string;
  unit: string;
  upcoming?: boolean;
  today?: boolean;
  /** What the coach said about it. */
  notes?: InboxMessage[];
}) {
  const state = completion(session.done, session.prescribed);
  const pr = session.rows.some((r) => r.logs.some((l) => l.pr));
  const badge = upcoming
    ? { text: t("Planned"), cls: "bg-surface-3 text-muted" }
    : pr
      ? { text: t("PR"), cls: "bg-cal-pr text-black" }
      : state === "done"
        ? { text: t("Done"), cls: "bg-cal-done text-white" }
        : state === "partial"
          ? { text: t("{done}/{of} sets", { done: session.done, of: session.prescribed }), cls: "bg-cal-done/20 text-cal-done" }
          : { text: today ? t("To do") : t("Missed"), cls: "bg-surface-3 text-muted" };

  return (
    <Link href={href} className="block rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium">
          {session.label}
        </span>
        {badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.text}</span>}
      </div>
      <div className="mt-0.5 text-[12px] text-muted-2">
        {session.phase} · {t("week {n}", { n: session.week })}
      </div>

      <ul className="mt-2 space-y-1">
        {session.rows.map((row) => {
          const logged = row.logs.filter((l) => l.done);
          const load = row.loads.find((l) => l !== null);
          return (
            <li key={row.id} className="text-[13px]">
              <div className="flex justify-between gap-2">
                <span className="truncate">{row.exercise}</span>
                <span className="shrink-0 text-muted">
                  {row.sets ?? "—"}×{row.reps ?? "—"} @ {load != null ? `${load} ${unit}` : row.prescription}
                </span>
              </div>
              {!upcoming && logged.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {logged.map((l) => (
                    <span key={l.setIndex} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] tabular-nums text-muted">
                      {formatSet(l)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {notes.map((n) => (
        <p key={n.id} className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-[12px] leading-snug text-foreground">
          <span className="mr-1.5 text-[10px] font-semibold tracking-wider text-accent">{t("COACH")}</span>
          {n.body}
        </p>
      ))}
    </Link>
  );
}
