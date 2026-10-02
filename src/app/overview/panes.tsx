import Link from "next/link";
import type { ReactNode } from "react";
import { overviewHref, type OverviewTab } from "@/lib/overview-tabs";
import { ChatView } from "@/components/tracking/ChatView";
import { ScheduleCalendar, type CalendarSession } from "@/components/tracking/ScheduleCalendar";
import { ScheduleView } from "@/components/tracking/ScheduleView";
import { formatDate, formatMoment, weekdayOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { getAllPhasesForAthlete, getMeetings, getMessages, getMoves, type ChatSummary } from "@/lib/queries";
import { sessionsOf } from "@/lib/schedule";

type Who = { id: string; name: string; hasLink: boolean };

const when = (ymd: string) => `${weekdayShort(weekdayOf(ymd))} ${formatDate(ymd)}`;

/** Athletes down the left, the chosen one's view on the right: Schedule and Chat alike. */
function Split({ list, children }: { list: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5 grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
      <ul className="space-y-0.5 self-start md:sticky md:top-0">{list}</ul>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Pick({ tab, athleteId, on, children, badge }: { tab: OverviewTab; athleteId?: string; on: boolean; children: ReactNode; badge: number }) {
  return (
    <li>
      <Link
        href={overviewHref(tab, athleteId)}
        scroll={false}
        aria-current={on ? "page" : undefined}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${on ? "bg-accent-soft text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
      >
        <span className="min-w-0 flex-1">{children}</span>
        {badge > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold tabular-nums leading-4 text-white">{badge}</span>}
      </Link>
    </li>
  );
}

/**
 * Chat with every athlete: the conversations down the left, unread first, then the newest;
 * the open one on the right.
 */
export async function ChatPane({ athletes, picked, chats }: { athletes: Who[]; picked: string | undefined; chats: Map<string, ChatSummary> }) {
  const at = (id: string) => chats.get(id)?.last?.createdAt ?? "";
  const unread = (id: string) => chats.get(id)?.unread ?? 0;
  const sorted = [...athletes].sort((a, b) => Number(unread(b.id) > 0) - Number(unread(a.id) > 0) || at(b.id).localeCompare(at(a.id)));
  const athlete = athletes.find((a) => a.id === picked) ?? sorted[0];
  if (!athlete) return null;

  return (
    <Split
      list={sorted.map((a) => {
        const last = chats.get(a.id)?.last;
        return (
          <Pick key={a.id} tab="chat" athleteId={a.id} on={a.id === athlete.id} badge={a.id === athlete.id ? 0 : unread(a.id)}>
            <span className="block truncate font-medium">{a.name}</span>
            <span className="block truncate text-[11px] text-muted-2">
              {last ? `${last.sender === "coach" ? `${t("You")}: ` : ""}${last.body}` : t("No messages yet.")}
            </span>
          </Pick>
        );
      })}
    >
      <ChatView
        key={athlete.id}
        athlete={{ id: athlete.id, name: athlete.name }}
        messages={await getMessages(athlete.id)}
        unread={unread(athlete.id)}
        hasLink={athlete.hasLink}
      />
    </Split>
  );
}

/**
 * Schedule for every athlete: what waits on the coach and one calendar of everyone's moved
 * sessions and meetings — or, for one athlete, their own Schedule to answer and plan in.
 */
export async function SchedulePane({
  athletes,
  picked,
  news,
  today,
}: {
  athletes: Who[];
  picked: string | undefined;
  news: Map<string, number>;
  today: string;
}) {
  const athlete = athletes.find((a) => a.id === picked);
  const list = (
    <>
      <Pick tab="schedule" on={!athlete} badge={0}>
        <span className="font-medium">{t("All athletes")}</span>
      </Pick>
      {athletes.map((a) => (
        <Pick key={a.id} tab="schedule" athleteId={a.id} on={a.id === athlete?.id} badge={news.get(a.id) ?? 0}>
          <span className="block truncate">{a.name}</span>
        </Pick>
      ))}
    </>
  );

  if (athlete) {
    const [phases, moves, meetings] = await Promise.all([getAllPhasesForAthlete(athlete.id), getMoves(athlete.id), getMeetings(athlete.id)]);
    // Every session with something in it, where it now falls, and whether it was done.
    type Phase = (typeof phases)[number];
    const calendar: CalendarSession[] = sessionsOf<Phase["weeks"][number]["days"][number], Phase>(phases, new Map(moves.map((m) => [m.dayId, m.day])))
      .filter((s) => s.day.rows.some((r) => r.exercise.trim() !== ""))
      .map((s) => ({
        ymd: s.ymd,
        label: s.day.label,
        movedFrom: s.movedFrom ?? null,
        status: s.day.rows.some((r) => r.actualWeight !== null) ? "done" : s.ymd < today ? "missed" : "plan",
      }));
    return (
      <Split list={list}>
        <h2 className="text-[15px] font-semibold">{athlete.name}</h2>
        <ScheduleView key={athlete.id} athlete={{ id: athlete.id, name: athlete.name }} today={today} moves={moves} meetings={meetings} calendar={calendar} />
      </Split>
    );
  }

  const ids = athletes.map((a) => a.id);
  const [moves, meetings] = await Promise.all([getMoves(ids), getMeetings(ids)]);
  const name = new Map(athletes.map((a) => [a.id, a.name]));
  const waiting = [
    ...moves
      .filter((m) => m.seenAt === null)
      .map((m) => ({
        key: m.id,
        athleteId: m.athleteId,
        at: m.updatedAt,
        text: t("{name} moved {session} to {date}", { name: name.get(m.athleteId) ?? "", session: m.label ?? t("Session"), date: when(m.day) }),
      })),
    ...meetings
      .filter((m) => m.status === "PROPOSED" && m.proposedBy === "athlete" && m.day >= today)
      .map((m) => ({
        key: m.id,
        athleteId: m.athleteId,
        at: m.updatedAt,
        text: t("{name} asked to meet {date} {time}", { name: name.get(m.athleteId) ?? "", date: when(m.day), time: m.time }),
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Split list={list}>
      <section>
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted-2">{t("WAITING ON YOU")}</h2>
        {waiting.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted">{t("Nothing waiting on you.")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {waiting.map((w) => (
              <li key={w.key} className="flex items-center gap-3 px-3 py-2.5">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{w.text}</span>
                <span className="shrink-0 text-[11px] text-muted-2">{formatMoment(w.at)}</span>
                <Link
                  href={overviewHref("schedule", w.athleteId)}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
                >
                  {t("Open")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ScheduleCalendar
        today={today}
        sessions={moves.map((m) => ({ ymd: m.day, label: m.label ?? t("Session"), status: "plan", movedFrom: m.fromDay, who: name.get(m.athleteId) }))}
        moves={[]}
        meetings={meetings.map((m) => ({ ...m, who: name.get(m.athleteId) }))}
      />
    </Split>
  );
}
