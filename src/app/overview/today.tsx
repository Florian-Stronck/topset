import Link from "next/link";
import { LOW_READINESS, readinessOf } from "@/lib/checkins";
import { daySets } from "@/lib/compliance";
import { formatDate, weekdayOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { formatPrescription } from "@/lib/intensity";
import { overviewHref } from "@/lib/overview-tabs";
import { addDays } from "@/lib/schedule";
import type { OverviewData } from "@/app/overview/data";

/** A session with a set logged this recently is still going. */
const LIVE_MINUTES = 45;

type Status = "now" | "next" | "done";

const card = "rounded-xl border border-border bg-surface";
const heading = "text-[11px] font-medium tracking-[0.16em] text-muted-2";

/**
 * Today across the roster: who is training right now, who's still to come and who's done,
 * with how they checked in this morning. Beside it what's on the calendar, what came in
 * since yesterday and what tomorrow holds.
 */
export function TodayPane({ data, athletes, now }: { data: OverviewData; athletes: { id: string; name: string; unit: "KG" | "LB" }[]; now: Date }) {
  const { today, week, sessions, checkins } = data;
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  const on = (id: string, ymd: string) => (sessions.get(id) ?? []).find((s) => s.ymd === ymd && daySets(s.rows).prescribed > 0) ?? null;

  const rows = athletes.flatMap((athlete) => {
    const s = on(athlete.id, today);
    if (!s) return [];
    const sets = daySets(s.rows);
    const last = s.rows.flatMap((r) => r.logs.filter((l) => l.done).map((l) => l.loggedAt)).sort().pop() ?? null;
    const minutes = last ? (now.getTime() - new Date(last).getTime()) / 60_000 : null;
    const status: Status = sets.done === 0 ? "next" : sets.done < sets.prescribed && minutes !== null && minutes <= LIVE_MINUTES ? "now" : "done";
    const c = checkins.get(athlete.id);
    const readiness = c ? readinessOf(c.questions, c.answers.filter((a) => a.day === today)) : null;
    const main = s.rows.filter((r) => r.exercise.trim() !== "" && (r.tier === "PRIMARY" || r.tier === "SECONDARY")).slice(0, 3);
    const lifts = (main.length > 0 ? main : s.rows.filter((r) => r.exercise.trim() !== "").slice(0, 2))
      .map((r) => {
        const presc = formatPrescription(r, athlete.unit);
        return `${r.exercise} ${r.sets ?? "—"}×${r.reps ?? "—"}${presc === "—" ? "" : ` · ${presc}`}`;
      })
      .join("   ");
    return [{ athlete, s, sets, last, minutes, status, readiness, lifts }];
  });
  const resting = athletes.filter((a) => !rows.some((r) => r.athlete.id === a.id));

  const groups: { status: Status; title: string; pill: string; dot: string }[] = [
    { status: "now", title: "TRAINING NOW", pill: "training now", dot: "bg-cal-moved" },
    { status: "next", title: "UP NEXT", pill: "up next", dot: "bg-muted" },
    { status: "done", title: "DONE", pill: "done", dot: "bg-ok" },
  ];
  const low = rows.filter((r) => r.readiness?.score != null && r.readiness.score <= LOW_READINESS);

  const meetings = data.meetings
    .filter((m) => m.day >= today && m.day <= addDays(today, 6) && (m.status === "ACCEPTED" || m.status === "PROPOSED"))
    .sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`));
  const name = new Map(athletes.map((a) => [a.id, a.name]));
  const meets = data.rows.filter((r) => r.meet && r.meet.days <= 30).sort((a, b) => a.meet!.days - b.meet!.days);
  const prs = data.prs.filter((p) => p.loggedAt.toISOString().slice(0, 10) >= yesterday);
  const unread = [...data.chats.values()].reduce((n, c) => n + c.unread, 0);
  const moved = data.moves.filter((m) => m.seenAt === null);
  const hurt = [...data.injuries.entries()].flatMap(([id, list]) => list.filter((i) => i.day >= yesterday).map((i) => ({ ...i, who: name.get(id) ?? "" })));
  const tomorrowList = athletes.filter((a) => on(a.id, tomorrow));
  const when = (ymd: string) => (ymd === today ? t("Today") : ymd === tomorrow ? t("Tomorrow") : `${weekdayShort(weekdayOf(ymd))} ${formatDate(ymd)}`);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <nav aria-label={t("This week")} className="grid grid-cols-7 gap-2">
        {week.map((ymd) => {
          const planned = athletes.filter((a) => on(a.id, ymd));
          const done = planned.filter((a) => daySets(on(a.id, ymd)!.rows).done > 0).length;
          const isToday = ymd === today;
          return (
            <div key={ymd} className={`${card} flex flex-col gap-1.5 px-3 py-2.5 ${isToday ? "border-accent/60 bg-surface-2" : ""}`}>
              <span className={`flex justify-between text-[11px] ${isToday ? "text-foreground" : "text-muted-2"}`}>
                <span className="tracking-[0.12em]">{weekdayShort(weekdayOf(ymd)).toUpperCase()}</span>
                <span>{formatDate(ymd)}</span>
              </span>
              <span className="text-[13px] font-semibold tabular-nums">
                {ymd > today ? t("{n} planned", { n: planned.length }) : `${done} / ${planned.length}`}
              </span>
              <span className="flex h-1 overflow-hidden rounded bg-surface-3">
                <span className="bg-ok" style={{ width: `${planned.length && ymd <= today ? (done / planned.length) * 100 : 0}%` }} />
              </span>
            </div>
          );
        })}
      </nav>

      <div className="flex flex-wrap gap-2 text-[12px] text-muted">
        <span className="rounded-full border border-border bg-surface px-3 py-1">
          <b className="text-foreground">{rows.length}</b> {t("train today")}
        </span>
        {groups.map((g) => (
          <span key={g.status} className="rounded-full border border-border bg-surface px-3 py-1">
            <b className="text-foreground">{rows.filter((r) => r.status === g.status).length}</b> {t(g.pill)}
          </span>
        ))}
        {low.length > 0 && (
          <span className="rounded-full border border-miss/50 bg-surface px-3 py-1">
            <b className="text-miss">{low.length}</b> {t("low readiness")}
          </span>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length === 0 && <p className={`${card} px-4 py-8 text-center text-[12px] text-muted-2`}>{t("Nobody trains today.")}</p>}
          {groups.map((g) => {
            const list = rows.filter((r) => r.status === g.status);
            if (list.length === 0) return null;
            return (
              <section key={g.status} className="flex flex-col gap-2">
                <h2 className={`${heading} flex items-center gap-2`}>
                  <span aria-hidden className={`size-2 rounded-full ${g.dot}`} />
                  {t(g.title)}
                </h2>
                <ul className={`${card} divide-y divide-border/60`}>
                  {list.map((r) => {
                    const lowNow = r.readiness?.score != null && r.readiness.score <= LOW_READINESS;
                    const track = `/tracking?athlete=${r.athlete.id}&block=${r.s.blockId}&week=${r.s.week}`;
                    return (
                      <li key={r.athlete.id} className="flex flex-col gap-2 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
                            {r.athlete.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-[200px] flex-1">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <Link href={track} className="text-[14px] font-semibold hover:text-accent">
                                {r.athlete.name}
                              </Link>
                              <span className="text-[12px] text-muted">
                                {r.s.phase} · {t("week {n}", { n: r.s.week })} · {r.s.label}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate text-[12px] text-muted">{r.lifts}</div>
                          </div>
                          <span
                            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${
                              lowNow ? "bg-miss/15 text-miss" : r.readiness?.score != null ? "bg-surface-3 text-muted" : "bg-surface-3 text-muted-2"
                            }`}
                          >
                            {r.readiness?.score != null ? t("Readiness {n}/5", { n: r.readiness.score }) : t("No check-in yet")}
                          </span>
                          <div className="flex w-[150px] flex-col gap-1">
                            <span className="flex justify-between text-[11px] text-muted">
                              <span suppressHydrationWarning>
                                {r.minutes === null ? t("not started") : r.minutes < 60 ? t("last set {n} min ago", { n: Math.max(1, Math.round(r.minutes)) }) : t("last set {time}", { time: new Date(r.last!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
                              </span>
                              <span className="tabular-nums text-foreground">
                                {r.sets.done} / {r.sets.prescribed}
                              </span>
                            </span>
                            <span className="flex h-[5px] overflow-hidden rounded bg-surface-3">
                              <span className={r.status === "now" ? "bg-cal-moved" : "bg-ok"} style={{ width: `${(r.sets.done / r.sets.prescribed) * 100}%` }} />
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            <Link href={overviewHref("chat", r.athlete.id)} className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent">
                              {t("Message")}
                            </Link>
                            {r.status !== "next" && (
                              <Link href={track} className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent">
                                {t("Review")}
                              </Link>
                            )}
                          </div>
                        </div>
                        {lowNow && r.status === "next" && (
                          <div className="ml-11 flex flex-wrap items-center gap-2 rounded-lg border border-miss/35 bg-miss/[0.06] px-3 py-2 text-[12.5px]">
                            <span className="min-w-[240px] flex-1">
                              {t("Readiness {n}/5 before training", { n: r.readiness!.score! })}
                              {r.readiness!.low.length > 0 && ` — ${r.readiness!.low.map((l) => `${l.label.toLowerCase()} ${l.value}`).join(", ")}`}
                            </span>
                            <Link
                              href={`/programming?athlete=${r.athlete.id}&phase=${r.s.blockId}`}
                              className="rounded-lg bg-accent px-3 py-1 text-[12px] font-medium text-white hover:opacity-90"
                            >
                              {t("Adjust today's session")}
                            </Link>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {resting.length > 0 && (
            <p className="text-[12px] text-muted-2">
              {t("Not training today: {names}", { names: resting.map((a) => a.name).join(", ") })}
            </p>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <section className={`${card} p-4`}>
            <h2 className={heading}>{t("AGENDA")}</h2>
            <ul className="mt-3 flex flex-col gap-3 text-[12.5px]">
              {meetings.length + moved.length + meets.length === 0 && <li className="text-muted-2">{t("Nothing on the calendar this week.")}</li>}
              {meetings.map((m) => (
                <li key={m.id} className="flex gap-3">
                  <span className="w-16 shrink-0 font-semibold tabular-nums text-cal-meeting">
                    {m.day === today ? m.time : when(m.day)}
                  </span>
                  <span>
                    {t("Meeting with {name} · {n} min", { name: name.get(m.athleteId) ?? "", n: m.minutes })}
                    <span className={`block ${m.status === "PROPOSED" ? "text-warn" : "text-muted-2"}`}>
                      {m.day !== today && `${m.time} · `}
                      {m.status === "PROPOSED" ? (m.proposedBy === "athlete" ? t("waiting on you") : t("waiting on them")) : t("accepted")}
                      {m.place && ` · ${m.place}`}
                    </span>
                  </span>
                </li>
              ))}
              {moved.map((m) => (
                <li key={m.id} className="flex gap-3">
                  <span className="w-16 shrink-0 font-semibold text-cal-moved">{when(m.day)}</span>
                  <span>
                    {t("{name} moved {session}", { name: name.get(m.athleteId) ?? "", session: m.label ?? t("Session") })}
                    <Link href={overviewHref("schedule", m.athleteId)} className="block text-warn hover:underline">
                      {t("from {date} · not seen yet", { date: when(m.fromDay) })}
                    </Link>
                  </span>
                </li>
              ))}
              {meets.map((r) => (
                <li key={r.id} className="flex gap-3">
                  <span className="w-16 shrink-0 font-semibold text-cal-meet">{t("{n}d", { n: r.meet!.days })}</span>
                  <span>
                    {r.name} · {r.meet!.name}
                    {r.meet!.weightClass && <span className="block text-muted-2">{r.meet!.weightClass}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={`${card} p-4`}>
            <h2 className={heading}>{t("SINCE YESTERDAY")}</h2>
            <ul className="mt-3 flex flex-col gap-2 text-[12.5px]">
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-pr" />
                {prs.length === 0
                  ? t("No PRs")
                  : t("{n} PRs — {list}", {
                      n: prs.length,
                      list: prs
                        .slice(0, 3)
                        .map((p) => `${p.athlete.split(" ")[0]} ${p.exercise.toLowerCase()} ${p.weight ?? ""}${p.reps ? ` × ${p.reps}` : ""}`)
                        .join(", "),
                    })}
              </li>
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
                <Link href={overviewHref("chat")} className="hover:text-accent">
                  {t(unread === 1 ? "{n} unread message" : "{n} unread messages", { n: unread })}
                </Link>
              </li>
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-cal-moved" />
                {t(moved.length === 1 ? "{n} session moved by an athlete" : "{n} sessions moved by athletes", { n: moved.length })}
              </li>
              {hurt.map((i) => (
                <li key={i.id} className="flex items-baseline gap-2">
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
                  {t("{name} logged an injury, {n}/5", { name: i.who, n: i.severity })}
                </li>
              ))}
            </ul>
          </section>

          <section className={`${card} p-4`}>
            <h2 className={heading}>{t("TOMORROW")}</h2>
            <p className="mt-3 text-[13px]">
              <b>{tomorrowList.length}</b> <span className="text-muted">{t(tomorrowList.length === 1 ? "session planned" : "sessions planned")}</span>
            </p>
            {tomorrowList.length > 0 && <p className="mt-1 text-[12px] text-muted">{tomorrowList.map((a) => a.name).join(", ")}</p>}
            {data.rows
              .filter((r) => r.daysLeft !== null && r.daysLeft <= 3)
              .map((r) => (
                <p key={r.id} className="mt-2 text-[12px] text-warn">
                  {t("{name}'s phase ends in {n} days", { name: r.name, n: Math.max(0, r.daysLeft!) })}
                </p>
              ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
