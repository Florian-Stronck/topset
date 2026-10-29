import { bodyweightSummary, dailyWeights, projectWeight, weightToMake } from "@/lib/bodyweight";
import { latestReadiness } from "@/lib/checkins";
import { daySets, prescribedRpe, rpeDelta, rpeDrift } from "@/lib/compliance";
import { formatDate, today as calendarToday, weekdayOf, weekStartOf, ymdOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { setText, type InboxItem, type InboxKind, type ReviewLine } from "@/lib/inbox";
import { injuryLabel } from "@/lib/injuries";
import { formatPrescription } from "@/lib/intensity";
import {
  athleteTraining,
  blockWindow,
  currentBlock,
  flagsFor,
  phaseSpan,
  startOfDay,
  trainingFlags,
  type AthleteSummary,
  type FlagAction,
  type TrainingSession,
} from "@/lib/overview";
import { overviewHref } from "@/lib/overview-tabs";
import {
  getActiveInjuries,
  getBodyweights,
  getCheckins,
  getMeetings,
  getMessages,
  getMoves,
  getNextMeets,
  getRecentPrs,
  getTrainingWindow,
  getVideoRows,
  type ChatSummary,
} from "@/lib/queries";
import { DONE_WEEKS, liftTrends, TREND_DAYS, TREND_WEEKS, weeklyDone, weeklyDrift, weeklyReadiness, weekStarts, type RosterRow } from "@/lib/roster";
import { addDays, daysBetween } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";
import { syncEnabled } from "@/lib/sync";
import { readinessSeries } from "@/lib/tracking";

/** Which inbox kind each roster flag files under. */
const KIND: Record<FlagAction, InboxKind> = {
  program: "program",
  review: "training",
  link: "link",
  checkins: "wellness",
  weight: "weight",
  sessions: "session",
};

/** How far back a logged session still waits for review, and a PR still makes the inbox. */
const REVIEW_DAYS = 14;
const PR_DAYS = 7;

const when = (ymd: string) => `${weekdayShort(weekdayOf(ymd))} ${formatDate(ymd)}`;

/**
 * Everything the Overview's roster, inbox, Today, Season and Insights read, in one pass:
 * the last eight weeks of sessions, check-ins and weigh-ins, and what's waiting on the coach.
 */
export async function loadOverview(
  now: Date,
  {
    athletes,
    targetsByBlock,
    linked,
    chats,
    coachId,
  }: {
    athletes: AthleteSummary[];
    targetsByBlock: Map<string, { target: string; tier: string }[]>;
    linked: Set<string>;
    chats: Map<string, ChatSummary>;
    coachId: string;
  },
) {
  const settings = activeSettings();
  const today = ymdOf(calendarToday());
  const ids = athletes.map((a) => a.id);
  const thisWeek = weekStartOf(today, settings.weekStart);
  const week = Array.from({ length: 7 }, (_, i) => addDays(thisWeek, i));
  const trend = weekStarts(thisWeek, TREND_WEEKS);
  const from = [trend[0], addDays(today, -(TREND_DAYS * 2 - 1))].sort()[0];
  // Tomorrow too, for Today's look ahead.
  const to = [week[6], addDays(today, 1)].sort()[1];

  const unread = ids.filter((id) => (chats.get(id)?.unread ?? 0) > 0);
  const [sessions, weights, nextMeets, checkins, prs, injuries, moves, meetings, videos, threads] = await Promise.all([
    getTrainingWindow(ids, from, to),
    getBodyweights(ids, addDays(today, -21)),
    getNextMeets(ids, startOfDay(now)),
    getCheckins(ids, from),
    getRecentPrs(coachId),
    getActiveInjuries(ids, today),
    getMoves(ids),
    getMeetings(ids),
    getVideoRows(ids, addDays(today, -(REVIEW_DAYS - 1))),
    Promise.all(unread.map(async (id) => [id, (await getMessages(id)).slice(-4)] as const)),
  ]);
  const thread = new Map(threads);
  const linksOn = syncEnabled();
  const items: InboxItem[] = [];

  const rows: RosterRow[] = athletes.map((athlete) => {
    const unit = athlete.unit === "LB" ? "lb" : "kg";
    const block = currentBlock(athlete.blocks, now, athlete.activeProgramId);
    const window = block ? blockWindow(block, now) : null;
    const list: TrainingSession[] = sessions.get(athlete.id) ?? [];
    const training = athleteTraining(list, athlete.blocks.map(phaseSpan), week, today);
    const daily = dailyWeights(weights.get(athlete.id) ?? []);
    const bodyweight = bodyweightSummary(daily, today);
    const meet = nextMeets.get(athlete.id);
    const nextMeet = meet
      ? { name: meet.name, days: daysBetween(today, ymdOf(meet.date)), weightClass: meet.weightClass, limit: weightToMake(meet).limit }
      : null;
    const answers = checkins.get(athlete.id);
    const readiness = answers ? latestReadiness(answers.questions, answers.answers) : null;

    const review = block
      ? `/tracking?athlete=${athlete.id}&block=${block.id}${window?.status === "active" ? `&week=${window.week}` : ""}`
      : `/tracking?athlete=${athlete.id}`;
    const programHref = block ? `/programming?athlete=${athlete.id}&phase=${block.id}` : `/programming?athlete=${athlete.id}`;
    const wellness = `/tracking?athlete=${athlete.id}&view=wellness`;
    const fix: Record<FlagAction, { hrefLabel: string; href: string }> = {
      program: { hrefLabel: t("Open programming"), href: programHref },
      review: { hrefLabel: t("Open tracking"), href: review },
      link: { hrefLabel: t("Send link"), href: `/athletes?link=${athlete.id}` },
      checkins: { hrefLabel: t("See check-ins"), href: `${wellness}#checkins` },
      weight: { hrefLabel: t("See weight"), href: wellness },
      sessions: { hrefLabel: t("Open tracking"), href: review },
    };
    const add = (item: Omit<InboxItem, "athleteId" | "athlete">) => items.push({ ...item, athleteId: athlete.id, athlete: athlete.name });

    const flags = [
      ...flagsFor(athlete, now, block ? (targetsByBlock.get(block.id) ?? []) : []),
      ...trainingFlags(training, { hasLink: linked.has(athlete.id), linksOn, bodyweight, meet: nextMeet, unit, today, readiness }),
    ];
    for (const flag of flags) {
      add({ key: `${athlete.id}:${flag.key}`, kind: KIND[flag.action], text: flag.text, urgent: flag.urgent ?? false, at: null, ...fix[flag.action] });
    }

    // A bad injury, or a knock to the head, is worth a word before the next session.
    const hurt = injuries.get(athlete.id) ?? [];
    for (const injury of hurt.filter((i) => i.severity >= 4 || i.area === "head")) {
      add({
        key: `injury-${injury.id}-${injury.severity}`,
        kind: "wellness",
        text: t("{injury} injury, {n}/5 — since {date}", { injury: injuryLabel(injury), n: injury.severity, date: formatDate(injury.day) }),
        urgent: true,
        at: null,
        hrefLabel: t("See injury"),
        href: wellness,
      });
    }

    // Sessions with sets logged since the coach last looked.
    for (const s of list) {
      if (s.ymd > today || s.ymd < addDays(today, -(REVIEW_DAYS - 1))) continue;
      const done = s.rows.flatMap((r) => r.logs.filter((l) => l.done));
      const last = done.map((l) => l.loggedAt).sort().pop();
      if (!last || (s.reviewedAt !== null && s.reviewedAt >= last)) continue;
      const sets = daySets(s.rows);
      const drift = rpeDrift(s.rows).mean;
      const filmed = videos.get(`${athlete.id}|${s.ymd}`) ?? [];
      const lines: ReviewLine[] = s.rows
        .filter((r) => r.exercise.trim() !== "")
        .map((r) => {
          const target = prescribedRpe(r);
          const logged = r.logs.filter((l) => l.done);
          const scheme = r.sets !== null && r.reps !== null ? `${r.sets} × ${r.reps}${r.repsMax ? `–${r.repsMax}` : ""}` : r.sets !== null ? `${r.sets} × —` : "";
          const intensity = formatPrescription(r, athlete.unit);
          return {
            id: r.id,
            exercise: r.exercise,
            prescribed: [scheme, intensity === "—" ? "" : intensity, r.load !== null ? `${r.load} ${unit}` : ""].filter(Boolean).join(" · ") || "—",
            sets:
              logged.length > 0
                ? logged.map((l) => {
                    const rpe = l.rpe ?? (l.rir !== null ? 10 - l.rir : null);
                    return { text: setText(l), over: target !== null && rpe !== null && rpe > target, pr: l.pr };
                  })
                : r.actualWeight !== null
                  ? [{ text: setText({ weight: r.actualWeight, reps: r.reps, rpe: r.performedRpe, rir: null }), over: false, pr: false }]
                  : [],
            delta: rpeDelta(r),
            note: r.athleteNotes?.trim() || null,
            video: filmed.includes(r.id),
          };
        });
      const notes = lines.filter((l) => l.note).length;
      add({
        key: `session-${s.dayId}`,
        kind: "session",
        text: [
          `${s.label} · ${t("week {n}", { n: s.week })}`,
          t("{done}/{of} sets", { done: sets.done, of: sets.prescribed }),
          drift !== null && Math.abs(drift) >= 0.5 ? t("RPE {d} vs plan", { d: drift > 0 ? `+${drift}` : drift }) : "",
          filmed.length > 0 ? t(filmed.length === 1 ? "{n} video" : "{n} videos", { n: filmed.length }) : "",
          notes > 0 ? t(notes === 1 ? "{n} note" : "{n} notes", { n: notes }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        urgent: false,
        at: last,
        hrefLabel: t("Open in Tracking"),
        href: `/tracking?athlete=${athlete.id}&block=${s.blockId}&week=${s.week}`,
        session: { dayId: s.dayId, ymd: s.ymd, label: s.label, phase: s.phase, week: s.week, done: sets.done, prescribed: sets.prescribed, last, lines },
      });
    }

    const chat = chats.get(athlete.id);
    if (chat && chat.unread > 0 && chat.last) {
      const recent = thread.get(athlete.id) ?? [];
      const theirs = [...recent].reverse().find((m) => m.sender === "athlete");
      add({
        key: `message-${athlete.id}-${theirs?.createdAt ?? chat.last.createdAt}`,
        kind: "message",
        text: `“${(theirs?.body ?? chat.last.body).slice(0, 200)}”`,
        urgent: false,
        at: theirs?.createdAt ?? chat.last.createdAt,
        hrefLabel: t("Open chat"),
        href: overviewHref("chat", athlete.id),
        message: { recent: recent.map((m) => ({ body: m.body, mine: m.sender === "coach", at: m.createdAt })) },
      });
    }

    for (const m of moves.filter((m) => m.athleteId === athlete.id && m.seenAt === null)) {
      add({
        key: `move-${m.id}`,
        kind: "move",
        text:
          t("Moved {session} from {from} to {to}", { session: m.label ?? t("Session"), from: when(m.fromDay), to: when(m.day) }) +
          (m.reason ? ` — “${m.reason}”` : ""),
        urgent: false,
        at: m.updatedAt,
        hrefLabel: t("Open schedule"),
        href: overviewHref("schedule", athlete.id),
        moveId: m.id,
      });
    }

    for (const m of meetings.filter((m) => m.athleteId === athlete.id && m.status === "PROPOSED" && m.proposedBy === "athlete" && m.day >= today)) {
      add({
        key: `meeting-${m.id}-${m.updatedAt}`,
        kind: "meeting",
        text:
          t("Asked to meet {date} {time} · {n} min", { date: when(m.day), time: m.time, n: m.minutes }) +
          (m.place ? ` · ${m.place}` : "") +
          (m.note ? ` — “${m.note}”` : ""),
        urgent: m.day <= addDays(today, 1),
        at: m.updatedAt,
        hrefLabel: t("Open schedule"),
        href: overviewHref("schedule", athlete.id),
        meetingId: m.id,
      });
    }

    for (const p of prs.filter((p) => p.athleteId === athlete.id && ymdOf(p.loggedAt) >= addDays(today, -(PR_DAYS - 1)))) {
      add({
        key: `pr-${p.id}`,
        kind: "pr",
        text:
          `${p.exercise} ${p.weight === null ? "—" : `${p.weight} ${unit}`}` +
          (p.reps === null ? "" : ` × ${p.reps}`) +
          (p.rpe !== null ? ` @${p.rpe}` : p.rir !== null ? ` RIR ${p.rir}` : ""),
        urgent: false,
        at: p.loggedAt.toISOString(),
        hrefLabel: t("Open in Tracking"),
        href: `/tracking?athlete=${athlete.id}&block=${p.blockId}&week=${p.week}`,
      });
    }

    const weight = bodyweight.avg7 ?? bodyweight.latest?.weight ?? null;
    const series = answers ? readinessSeries(answers.questions, answers.answers, trend[0], today) : [];
    const lifts = liftTrends(list, today, athlete.unit, athlete.rpeTable);
    const maxes = { squat: block?.squat1RM ?? athlete.squat1RM, bench: block?.bench1RM ?? athlete.bench1RM, dead: block?.dead1RM ?? athlete.dead1RM };
    return {
      id: athlete.id,
      name: athlete.name,
      unit,
      href: review,
      programHref,
      phase:
        block && window
          ? { name: block.phase, program: block.name, status: window.status, week: window.week, of: block.weeks, start: ymdOf(block.startDate) }
          : null,
      daysLeft: window?.status === "active" ? window.daysLeft : null,
      training: list.some((s) => s.ymd === today && daySets(s.rows).prescribed > 0),
      lastLog: training.lastDone,
      done: weeklyDone(list, trend.slice(-DONE_WEEKS), today),
      weekPct: training.weekPct,
      rpe: weeklyDrift(list, trend),
      readiness: weeklyReadiness(series, trend),
      phaseId: block?.id ?? null,
      lifts: {
        squat: { ...lifts.squat, onFile: maxes.squat, onPhase: block?.squat1RM != null },
        bench: { ...lifts.bench, onFile: maxes.bench, onPhase: block?.bench1RM != null },
        dead: { ...lifts.dead, onFile: maxes.dead, onPhase: block?.dead1RM != null },
      },
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
        ...nextMeet,
        projected: meet ? (projectWeight(daily, today, weightToMake(meet).day)?.weight ?? null) : null,
      },
    };
  });

  return { today, thisWeek, week, trend, rows, items, sessions, checkins, weights, prs, injuries, moves, meetings, chats };
}

export type OverviewData = Awaited<ReturnType<typeof loadOverview>>;
