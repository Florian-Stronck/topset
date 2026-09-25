import Link from "next/link";
import { notFound } from "next/navigation";
import { getAthleteByToken, getAthleteSchedule, inboxFor, sessionsInFull, type AthleteSession, type InboxMessage } from "@/lib/athlete-queries";
import { shortDate } from "@/lib/athlete-format";
import { athleteToday } from "@/lib/athlete-today";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";
import { completion, formatSet } from "@/lib/setlog";

export const dynamic = "force-dynamic";

/** How far ahead "coming up" looks. */
const AHEAD = 8;

/** What's been done so far, set against the plan, and the next few sessions after today. */
export default async function AthleteHistory({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const athlete = await getAthleteByToken(token);
  if (!athlete) notFound();
  await loadSettings(athlete.coachId);

  const today = await athleteToday();
  const schedule = await getAthleteSchedule(athlete);
  // Only the days this page lists: everything so far, and the next few.
  const shown = await sessionsInFull(athlete, [
    ...schedule.filter((s) => s.ymd <= today),
    ...schedule.filter((s) => s.ymd > today).slice(0, AHEAD),
  ]);
  const notes = await inboxFor(athlete.id, shown.map((s) => s.ymd));
  const notesOn = (ymd: string) => notes.filter((n) => n.day === ymd);
  const upcoming = shown.filter((s) => s.ymd > today);
  const past = shown.filter((s) => s.ymd <= today).reverse();
  const u = athlete.unit === "LB" ? "lb" : "kg";
  const base = `/a/${token}`;

  const done = past.filter((s) => completion(s.done, s.prescribed) === "done").length;

  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-tight">{t("History")}</h1>
      {past.length > 0 && (
        <p className="mt-1 text-[13px] text-muted">
          {t("{done} of {of} sessions completed", { done, of: past.length })}
        </p>
      )}

      {upcoming.length > 0 && (
        <section className="mt-5">
          <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("COMING UP")}</h2>
          <div className="mt-2 space-y-2">
            {upcoming.map((s) => (
              <SessionItem key={s.ymd} session={s} href={`${base}?d=${s.ymd}`} unit={u} upcoming />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("DONE SO FAR")}</h2>
        {past.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">{t("Nothing yet. Your first session will show up here.")}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {past.map((s) => (
              <SessionItem
                key={s.ymd}
                session={s}
                href={s.ymd === today ? base : `${base}?d=${s.ymd}`}
                unit={u}
                today={s.ymd === today}
                notes={notesOn(s.ymd)}
              />
            ))}
          </div>
        )}
      </section>
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
  const badge = upcoming
    ? null
    : state === "done"
      ? { text: t("Done"), cls: "bg-ok/15 text-ok" }
      : state === "partial"
        ? { text: t("{done}/{of} sets", { done: session.done, of: session.prescribed }), cls: "bg-accent-soft text-accent" }
        : { text: today ? t("To do") : t("Missed"), cls: "bg-surface-3 text-muted" };

  return (
    <Link href={href} className="block rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium">
          {shortDate(session.ymd)} · {session.label}
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
