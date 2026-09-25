import Link from "next/link";
import { OverviewBoard, type BoardRow } from "@/components/OverviewBoard";
import { RefreshButton } from "@/components/RefreshButton";
import { Sidebar } from "@/components/Sidebar";
import { bodyweightSummary, classLimit, dailyWeights, projectWeight } from "@/lib/bodyweight";
import { loadSettings } from "@/lib/coach-settings";
import { today as calendarToday, weekStartOf, ymdOf } from "@/lib/dates";
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
import { getBodyweights, getNextMeets, getOverview, getReadiness, getRecentCheckins, getTrainingWindow } from "@/lib/queries";
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
  kind: "flag" | "checkin";
};

export default async function OverviewPage() {
  await loadSettings();
  const now = new Date();
  const today = ymdOf(calendarToday());
  const settings = activeSettings();
  const { coach, athletes, targetsByBlock, linked } = await getOverview(now);
  const ids = athletes.map((a) => a.id);

  const weekStart = weekStartOf(today, settings.weekStart);
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const from = [addDays(today, -(COMPLIANCE_DAYS - 1)), week[0]].sort()[0];
  const to = [today, week[6]].sort()[1];

  const [checkins, sessions, weights, meets, readiness] = await Promise.all([
    getRecentCheckins(coach.id),
    getTrainingWindow(ids, from, to),
    // Three weeks is enough for this week's average and the one before.
    getBodyweights(ids, addDays(today, -21)),
    getNextMeets(ids, startOfDay(now)),
    getReadiness(ids, addDays(today, -6)),
  ]);
  const linksOn = syncEnabled();

  const feedFlags: FeedItem[] = [];
  const rows: BoardRow[] = athletes.map((athlete) => {
    const unit = athlete.unit === "LB" ? "lb" : "kg";
    const block = currentBlock(athlete.blocks, now);
    const window = block ? blockWindow(block, now) : null;
    const training = athleteTraining(sessions.get(athlete.id) ?? [], athlete.blocks.map(phaseSpan), week, today);
    const daily = dailyWeights(weights.get(athlete.id) ?? []);
    const bodyweight = bodyweightSummary(daily, today);
    const meet = meets.get(athlete.id);
    const nextMeet = meet
      ? { name: meet.name, days: daysBetween(today, ymdOf(meet.date)), weightClass: meet.weightClass, limit: classLimit(meet.weightClass) }
      : null;

    const review = block
      ? `/tracking?athlete=${athlete.id}&block=${block.id}${window?.status === "active" ? `&week=${window.week}` : ""}`
      : `/tracking?athlete=${athlete.id}`;
    const hrefFor: Record<FlagAction, { label: string; href: string }> = {
      program: { label: t("Program"), href: block ? `/programming?athlete=${athlete.id}&phase=${block.id}` : `/programming?athlete=${athlete.id}` },
      review: { label: t("Review"), href: review },
      link: { label: t("Send link"), href: `/athletes?link=${athlete.id}` },
    };

    const flags = [
      ...flagsFor(athlete, now, block ? (targetsByBlock.get(block.id) ?? []) : []),
      ...trainingFlags(training, {
        hasLink: linked.has(athlete.id),
        linksOn,
        bodyweight,
        meet: nextMeet,
        unit,
        today,
        readiness: readiness.get(athlete.id)?.at(-1) ?? null,
      }),
    ];
    flags.forEach((flag, i) =>
      feedFlags.push({
        key: `${athlete.id}-${i}`,
        athleteId: athlete.id,
        athlete: athlete.name,
        text: flag.text,
        action: hrefFor[flag.action],
        kind: "flag",
      }),
    );

    const weight = bodyweight.avg7 ?? bodyweight.latest?.weight ?? null;
    return {
      id: athlete.id,
      name: athlete.name,
      unit,
      href: review,
      running: window?.status === "active",
      flagged: flags.length > 0,
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
        projected: meet ? (projectWeight(daily, today, ymdOf(meet.date))?.weight ?? null) : null,
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

  const programs = new Set(athletes.flatMap((a) => a.blocks.map((b) => b.programId))).size;
  const phases = athletes.reduce((n, a) => n + a.blocks.length, 0);

  return (
    <div className="flex h-screen">
      <Sidebar athletes={athletes} coachUsername={coach.username} coachName={coach.name} section="overview" />

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-7">
          <h1 className="text-[22px] font-semibold tracking-tight">{t("Overview")}</h1>
          <p className="mt-1 text-[12px] text-muted">
            {now.toLocaleDateString(LOCALE[settings.language], {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>

          <OverviewBoard
            rows={rows}
            stats={{ athletes: athletes.length, programs, phases }}
            week={week.map((ymd) => ({
              ymd,
              day: weekdayShort((settings.weekStart + week.indexOf(ymd)) % 7),
              today: ymd === today,
            }))}
            feed={<Feed flags={feedFlags} checkins={checkinItems} />}
          />
        </div>
      </main>
    </div>
  );
}

/** Warnings first, then what athletes logged, newest first — each with one thing to do about it. */
function Feed({ flags, checkins }: { flags: FeedItem[]; checkins: FeedItem[] }) {
  return (
    <section id="feed" className="mt-7 scroll-mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("NEEDS ATTENTION AND CHECK-INS")}</h2>
        <RefreshButton />
      </div>
      {flags.length + checkins.length === 0 ? (
        <p className="mt-2 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-muted">{t("All caught up.")}</p>
      ) : (
        <div className="mt-2 max-h-[420px] divide-y divide-border overflow-auto rounded-xl border border-border bg-surface">
          {[...flags, ...checkins].map((item) => (
            <div key={item.key} className="flex items-center gap-3 px-4 py-2.5">
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${item.kind === "flag" ? "bg-warn" : "bg-ok"}`}
              />
              <Avatar name={item.athlete} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">
                  <span className="font-medium">{item.athlete}</span>
                  <span className={item.kind === "flag" ? "text-foreground" : "text-muted"}> · {item.text}</span>
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
      )}
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
