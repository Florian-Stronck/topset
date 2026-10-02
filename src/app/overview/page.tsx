import Link from "next/link";
import { OverviewBoard, type BoardRow, type Issue, type IssueCategory } from "@/components/OverviewBoard";
import { RefreshButton } from "@/components/RefreshButton";
import { Sidebar } from "@/components/Sidebar";
import { bodyweightSummary, dailyWeights, projectWeight, weightToMake } from "@/lib/bodyweight";
import { loadSettings } from "@/lib/coach-settings";
import { formatDate, today as calendarToday, weekStartOf, ymdOf } from "@/lib/dates";
import { LOCALE, t, weekdayShort } from "@/lib/i18n";
import {
  athleteTraining,
  blockWindow,
  COMPLIANCE_DAYS,
  currentBlock,
  flagsFor,
  phaseSpan,
  startOfDay,
  trainingFlags,
  type FlagAction,
} from "@/lib/overview";
import {
  chatSummary,
  getActiveInjuries,
  getBodyweights,
  getCheckins,
  getNextMeets,
  getOverview,
  getRecentCheckins,
  getRecentPrs,
  getTrainingWindow,
  getUnreviewed,
  scheduleNews,
} from "@/lib/queries";
import { OverviewTabs } from "@/components/OverviewTabs";
import type { OverviewTab } from "@/lib/overview-tabs";
import { ChatPane, SchedulePane } from "@/app/overview/panes";
import { injuryLabel } from "@/lib/injuries";
import { latestReadiness } from "@/lib/checkins";
import { formatEffort } from "@/lib/setlog";
import { Trophy } from "@/components/CheckinIcon";
import { addDays, daysBetween } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";
import { syncEnabled } from "@/lib/sync";

export const dynamic = "force-dynamic";

type FeedItem = {
  key: string;
  athleteId: string;
  athlete: string;
  text: string;
  detail?: string;
  action: { label: string; href: string };
  kind: "pr" | "checkin";
};

/** Which count across the top a flag adds to. */
const CATEGORY: Record<FlagAction, IssueCategory> = {
  program: "program",
  sessions: "review",
  link: "link",
  checkins: "wellness",
  review: "training",
  weight: "weight",
};

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ tab?: string; athlete?: string }> }) {
  await loadSettings();
  const params = await searchParams;
  const tab: OverviewTab = params.tab === "schedule" || params.tab === "chat" ? params.tab : "athletes";
  const now = new Date();
  const today = ymdOf(calendarToday());
  const settings = activeSettings();
  const { coach, athletes, targetsByBlock, linked } = await getOverview(now);
  const ids = athletes.map((a) => a.id);
  const [chats, waiting] = await Promise.all([chatSummary(ids), scheduleNews(ids, today)]);
  const sum = (counts: Iterable<number>) => [...counts].reduce((a, b) => a + b, 0);
  const news = { athletes: 0, schedule: sum(waiting.values()), chat: sum([...chats.values()].map((c) => c.unread)) };

  const frame = (body: React.ReactNode) => (
    <div className="flex h-screen">
      <Sidebar athletes={athletes} coachUsername={coach.username} coachName={coach.name} section="overview" />

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-7">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">{t("Overview")}</h1>
              <p className="mt-1 text-[12px] text-muted">
                {now.toLocaleDateString(LOCALE[settings.language], {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
            <RefreshButton />
          </div>
          <OverviewTabs tab={tab} news={news} />
          {body}
        </div>
      </main>
    </div>
  );

  const who = athletes.map((a) => ({ id: a.id, name: a.name, hasLink: linked.has(a.id) }));
  if (tab === "chat") return frame(<ChatPane athletes={who} picked={params.athlete} chats={chats} />);
  if (tab === "schedule") return frame(<SchedulePane athletes={who} picked={params.athlete} news={waiting} today={today} />);

  const weekStart = weekStartOf(today, settings.weekStart);
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const from = [addDays(today, -(COMPLIANCE_DAYS - 1)), week[0]].sort()[0];
  const to = [today, week[6]].sort()[1];

  const [checkins, sessions, weights, meets, answers, prs, unreviewed, injuries] = await Promise.all([
    getRecentCheckins(coach.id),
    getTrainingWindow(ids, from, to),
    // Three weeks is enough for this week's average and the one before.
    getBodyweights(ids, addDays(today, -21)),
    getNextMeets(ids, startOfDay(now)),
    getCheckins(ids, addDays(today, -6)),
    getRecentPrs(coach.id),
    getUnreviewed(coach.id),
    getActiveInjuries(ids, today),
  ]);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const linksOn = syncEnabled();

  const rows: BoardRow[] = athletes.map((athlete) => {
    const unit = athlete.unit === "LB" ? "lb" : "kg";
    const block = currentBlock(athlete.blocks, now);
    const window = block ? blockWindow(block, now) : null;
    const training = athleteTraining(sessions.get(athlete.id) ?? [], athlete.blocks.map(phaseSpan), week, today);
    const daily = dailyWeights(weights.get(athlete.id) ?? []);
    const bodyweight = bodyweightSummary(daily, today);
    const meet = meets.get(athlete.id);
    const nextMeet = meet
      ? { name: meet.name, days: daysBetween(today, ymdOf(meet.date)), weightClass: meet.weightClass, limit: weightToMake(meet).limit }
      : null;

    const review = block
      ? `/tracking?athlete=${athlete.id}&block=${block.id}${window?.status === "active" ? `&week=${window.week}` : ""}`
      : `/tracking?athlete=${athlete.id}`;
    const wellness = `/tracking?athlete=${athlete.id}&view=wellness`;
    const hrefFor: Record<FlagAction, { label: string; href: string }> = {
      program: { label: t("Open programming"), href: block ? `/programming?athlete=${athlete.id}&phase=${block.id}` : `/programming?athlete=${athlete.id}` },
      review: { label: t("Open tracking"), href: review },
      link: { label: t("Send link"), href: `/athletes?link=${athlete.id}` },
      checkins: { label: t("See check-ins"), href: `${wellness}#checkins` },
      weight: { label: t("See weight"), href: wellness },
      sessions: (() => {
        const u = unreviewed.get(athlete.id);
        return {
          label: t("Review sessions"),
          href: u ? `/tracking?athlete=${athlete.id}&block=${u.blockId}&week=${u.week}&show=unreviewed` : review,
        };
      })(),
    };
    const toReview = unreviewed.get(athlete.id)?.count ?? 0;

    const flags = [
      ...flagsFor(athlete, now, block ? (targetsByBlock.get(block.id) ?? []) : []),
      ...trainingFlags(training, {
        hasLink: linked.has(athlete.id),
        linksOn,
        bodyweight,
        meet: nextMeet,
        unit,
        today,
        readiness: (() => {
          const c = answers.get(athlete.id);
          return c ? latestReadiness(c.questions, c.answers) : null;
        })(),
      }),
      ...(toReview > 0
        ? [{ text: t(toReview === 1 ? "{n} session to review" : "{n} sessions to review", { n: toReview }), action: "sessions" as const }]
        : []),
    ];
    const issues: Issue[] = flags.map((flag, i) => ({
      key: `${athlete.id}-${i}`,
      text: flag.text,
      category: CATEGORY[flag.action],
      urgent: flag.urgent ?? false,
      fix: hrefFor[flag.action],
    }));
    // A bad injury, or a knock to the head, is worth a word before the next session.
    const hurt = injuries.get(athlete.id) ?? [];
    for (const injury of hurt.filter((i) => i.severity >= 4 || i.area === "head")) {
      issues.push({
        key: `${athlete.id}-injury-${injury.id}`,
        text: t("{injury} injury, {n}/5 — since {date}", { injury: injuryLabel(injury), n: injury.severity, date: formatDate(injury.day) }),
        category: "wellness",
        urgent: true,
        fix: { label: t("See injury"), href: wellness },
      });
    }
    const checkin = answers.get(athlete.id);
    const readiness = checkin ? latestReadiness(checkin.questions, checkin.answers) : null;

    const weight = bodyweight.avg7 ?? bodyweight.latest?.weight ?? null;
    return {
      id: athlete.id,
      name: athlete.name,
      unit,
      href: review,
      running: window?.status === "active",
      issues,
      readiness: readiness?.score != null ? { score: readiness.score, day: readiness.day } : null,
      injuries: hurt.map((i) => ({ label: injuryLabel(i), severity: i.severity })),
      prs: prs.filter((p) => p.athleteId === athlete.id && p.loggedAt >= weekAgo).length,
      phase:
        block && window
          ? {
              name: block.phase,
              program: block.name,
              status: window.status,
              week: window.week,
              of: block.weeks,
              start: ymdOf(block.startDate),
            }
          : null,
      daysLeft: window?.status === "active" ? window.daysLeft : null,
      cells: training.cells,
      weekPct: training.weekPct,
      pct28: training.pct28,
      bodyweight:
        weight === null
          ? null
          : {
              weight,
              change7: bodyweight.change7,
              age: bodyweight.age,
              overClass: nextMeet?.limit != null ? Math.round((weight - nextMeet.limit) * 10) / 10 : null,
            },
      meet: nextMeet && {
        name: nextMeet.name,
        days: nextMeet.days,
        weightClass: nextMeet.weightClass,
        limit: nextMeet.limit,
        projected: meet ? (projectWeight(daily, today, weightToMake(meet).day)?.weight ?? null) : null,
      },
    };
  });

  const checkinItems: FeedItem[] = checkins.map((c) => ({
    key: c.dayId,
    athleteId: c.athleteId,
    athlete: c.athlete,
    text: t("Logged {label} · {sets}", {
      label: c.label,
      sets: t(c.done === 1 ? "{n} set" : "{n} sets", { n: c.done }),
    }),
    detail: `${c.phase} · ${t("week {n}", { n: c.week })} · ${c.last.toLocaleString(LOCALE[settings.language], {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
    action: { label: t("Review"), href: `/tracking?athlete=${c.athleteId}&block=${c.blockId}&week=${c.week}` },
    kind: "checkin",
  }));

  const prItems: FeedItem[] = prs.slice(0, 8).map((p) => {
    const unitOf = athletes.find((a) => a.id === p.athleteId)?.unit === "LB" ? "lb" : "kg";
    return {
      key: `pr-${p.id}`,
      athleteId: p.athleteId,
      athlete: p.athlete,
      text:
        `${t("PR")} · ${p.exercise} ${p.weight === null ? "—" : `${p.weight} ${unitOf}`}` +
        (p.reps === null ? "" : ` × ${p.reps}`) +
        (formatEffort(p) ? ` ${formatEffort(p)}` : ""),
      detail: `${t("week {n}", { n: p.week })} · ${p.loggedAt.toLocaleString(LOCALE[settings.language], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`,
      action: { label: t("Review"), href: `/tracking?athlete=${p.athleteId}&block=${p.blockId}&week=${p.week}` },
      kind: "pr",
    };
  });

  return frame(
    <OverviewBoard
      rows={rows}
      week={week.map((ymd) => ({
        ymd,
        day: weekdayShort((settings.weekStart + week.indexOf(ymd)) % 7),
        today: ymd === today,
      }))}
      activity={<Activity prs={prItems} checkins={checkinItems} />}
    />
  );
}

/** PRs, then what athletes logged, newest first — each a click from its session. */
function Activity({ prs, checkins }: { prs: FeedItem[]; checkins: FeedItem[] }) {
  if (prs.length + checkins.length === 0) return null;
  return (
    <section id="feed" className="mt-7 scroll-mt-4">
      <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("RECENT ACTIVITY")}</h2>
      <div className="mt-2 max-h-[360px] divide-y divide-border overflow-auto rounded-xl border border-border bg-surface">
          {[...prs, ...checkins].map((item) => (
            <div key={item.key} className={`flex items-center gap-3 px-4 py-2.5 ${item.kind === "pr" ? "bg-pr/[0.06]" : ""}`}>
              {item.kind === "pr" ? (
                <Trophy size={12} className="shrink-0 text-pr" />
              ) : (
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-ok" />
              )}
              <Avatar name={item.athlete} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">
                  <span className="font-medium">{item.athlete}</span>
                  <span className={item.kind === "pr" ? "font-medium text-pr" : "text-muted"}>
                    {" · "}
                    {item.text}
                  </span>
                </div>
                {item.detail && <div className="truncate text-[11px] text-muted-2">{item.detail}</div>}
              </div>
              <Link
                href={item.action.href}
                className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
              >
                {item.action.label}
              </Link>
            </div>
          ))}
      </div>
    </section>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
