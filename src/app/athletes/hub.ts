import { loadOverview } from "@/app/overview/data";
import { dailyWeights } from "@/lib/bodyweight";
import { countsForReadiness } from "@/lib/checkins";
import { meetScore } from "@/lib/competition";
import { daySets, rpeDrift, type DayStatus } from "@/lib/compliance";
import { athleteTraining, blockWindow, currentBlock, phaseSpan, type AthleteSummary } from "@/lib/overview";
import { LIFT_ORDER, type LiftKey } from "@/lib/progress";
import { chatSummary, getOverview } from "@/lib/queries";
import { weeklyE1rm, type RosterRow } from "@/lib/roster";
import { addDays, daysBetween } from "@/lib/schedule";
import { ymdOf } from "@/lib/dates";
import { readinessSeries } from "@/lib/tracking";

/** How many days of readiness and bodyweight the hub draws. */
const READY_DAYS = 14;
const SESSIONS_SHOWN = 6;

/**
 * Everything the athlete hub's Overview tab draws for one athlete, worked out from the same
 * pass the Overview makes for the whole roster. Plain data, so it can cross to the client.
 */
export type HubData = {
  athleteId: string;
  row: RosterRow;
  /** The program being trained, phase by phase, with how much of each has gone by. */
  program: { name: string; week: number; of: number; meetAt: number | null; phases: { id: string; name: string; weeks: number; done: number; now: boolean }[] } | null;
  /** The session on the plan today. */
  today: { label: string; done: number; prescribed: number; href: string } | null;
  /** The first day of each week the trends cover, oldest first. */
  weeks: string[];
  e1rm: Record<LiftKey, (number | null)[]>;
  /** Each of those weeks, day by day. */
  heat: { ymd: string; status: DayStatus; label: string | null }[][];
  sessions: { dayId: string; ymd: string; label: string; week: number; done: number; prescribed: number; drift: number | null; notes: number; reviewed: boolean; href: string }[];
  readiness: { days: (number | null)[]; avg7: number | null; parts: { label: string; value: number }[] };
  prs: { id: string; text: string; ymd: string; href: string }[];
  /** Daily weigh-ins, oldest first. */
  weights: { day: string; weight: number }[];
  /** What waits on the coach for this athlete, from the inbox, but for sessions and PRs (shown on their own). */
  items: { key: string; text: string; urgent: boolean; href: string; hrefLabel: string }[];
  /** The total the estimated maxes add up to, and its meet score; null until all three lifts have one. */
  projected: { total: number; score: number | null } | null;
  onFileTotal: number | null;
};

const mean = (values: (number | null)[]) => {
  const v = values.filter((x): x is number => x !== null);
  return v.length === 0 ? null : Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
};

export async function loadHub(athleteId: string, now: Date): Promise<HubData | null> {
  const { coach, athletes, targetsByBlock, linked } = await getOverview(now);
  const athlete: AthleteSummary | undefined = athletes.find((a) => a.id === athleteId);
  if (!athlete) return null;
  const chats = await chatSummary([athlete.id]);
  const data = await loadOverview(now, { athletes: [athlete], targetsByBlock, linked, chats, coachId: coach.id });
  const { today, trend } = data;
  const row = data.rows[0];
  const list = data.sessions.get(athlete.id) ?? [];
  const tracking = (blockId: string, week: number) => `/tracking?athlete=${athlete.id}&block=${blockId}&week=${week}`;

  const block = currentBlock(athlete.blocks, now, athlete.activeProgramId);
  const siblings = block ? athlete.blocks.filter((b) => b.programId === block.programId).sort((a, b) => a.startDate.getTime() - b.startDate.getTime()) : [];
  const before = block ? siblings.slice(0, siblings.indexOf(block)).reduce((n, b) => n + b.weeks, 0) : 0;
  const program =
    block === null
      ? null
      : {
          name: block.name,
          week: before + blockWindow(block, now).week,
          of: siblings.reduce((n, b) => n + b.weeks, 0),
          // Where the next meet falls along the program, 0 to 1; null when it isn't in it.
          meetAt: (() => {
            if (!row.meet || siblings.length === 0) return null;
            const total = siblings.reduce((n, b) => n + b.weeks, 0) * 7;
            const at = (daysBetween(ymdOf(siblings[0].startDate), today) + row.meet.days) / total;
            return at >= 0 && at <= 1 ? Math.round(at * 1000) / 1000 : null;
          })(),
          phases: siblings.map((b) => {
            const w = blockWindow(b, now);
            const done = w.status === "done" ? 1 : w.status === "upcoming" ? 0 : 1 - w.daysLeft / (b.weeks * 7);
            return { id: b.id, name: b.phase, weeks: b.weeks, done: Math.round(done * 100) / 100, now: b.id === block.id };
          }),
        };

  const onDay = list.find((s) => s.ymd === today && daySets(s.rows).prescribed > 0);
  const spans = athlete.blocks.map(phaseSpan);
  const heat = trend.map((w) =>
    athleteTraining(list, spans, Array.from({ length: 7 }, (_, i) => addDays(w, i)), today).cells.map((c) => ({ ymd: c.ymd, status: c.status, label: c.label })),
  );

  const sessions = list
    .map((s) => ({ s, sets: daySets(s.rows) }))
    .filter(({ s, sets }) => sets.prescribed > 0 && (s.ymd < today || (s.ymd === today && sets.done > 0)))
    .sort((a, b) => b.s.ymd.localeCompare(a.s.ymd))
    .slice(0, SESSIONS_SHOWN)
    .map(({ s, sets }) => ({
      dayId: s.dayId,
      ymd: s.ymd,
      label: s.label,
      week: s.week,
      done: sets.done,
      prescribed: sets.prescribed,
      drift: rpeDrift(s.rows).mean,
      notes: s.rows.filter((r) => r.athleteNotes?.trim()).length,
      reviewed: s.reviewedAt !== null,
      href: tracking(s.blockId, s.week),
    }));

  const answers = data.checkins.get(athlete.id);
  const series = answers ? readinessSeries(answers.questions, answers.answers, addDays(today, -(READY_DAYS - 1)), today) : [];
  const lastWeek = series.slice(-7);
  const parts = (answers?.questions ?? [])
    .filter((q) => q.kind === "SCALE" && countsForReadiness(q))
    .map((q) => ({ label: q.label, value: mean(lastWeek.map((p) => p.byQuestion[q.id] ?? null)) }))
    .filter((p): p is { label: string; value: number } => p.value !== null);

  const unit = row.unit;
  const prs = data.prs
    .filter((p) => p.athleteId === athlete.id)
    .map((p) => ({
      id: p.id,
      text:
        `${p.exercise} ${p.weight === null ? "—" : `${p.weight} ${unit}`}` +
        (p.reps === null ? "" : ` × ${p.reps}`) +
        (p.rpe !== null ? ` @${p.rpe}` : p.rir !== null ? ` RIR ${p.rir}` : ""),
      ymd: p.loggedAt.toISOString().slice(0, 10),
      href: tracking(p.blockId, p.week),
    }));

  const sum = (values: (number | null)[]) => (values.every((v) => v !== null) ? Math.round(values.reduce((a: number, b) => a + b!, 0) * 10) / 10 : null);
  const total = sum(LIFT_ORDER.map((l) => row.lifts[l].e1rm));

  return {
    athleteId: athlete.id,
    row,
    program,
    today: onDay ? { label: onDay.label, ...daySets(onDay.rows), href: tracking(onDay.blockId, onDay.week) } : null,
    weeks: trend,
    e1rm: weeklyE1rm(list, trend, today, athlete.unit, athlete.rpeTable),
    heat,
    sessions,
    readiness: { days: series.map((p) => p.score), avg7: mean(lastWeek.map((p) => p.score)), parts },
    prs,
    weights: dailyWeights(data.weights.get(athlete.id) ?? []).filter((d) => d.day >= addDays(today, -(READY_DAYS * 2 - 1))),
    items: data.items
      .filter((i) => i.kind !== "session" && i.kind !== "pr")
      .map((i) => ({ key: i.key, text: i.text, urgent: i.urgent, href: i.href, hrefLabel: i.hrefLabel })),
    projected: total === null ? null : { total, score: meetScore(total, row.bodyweight?.weight ?? null, athlete.sex, athlete.unit) },
    onFileTotal: sum(LIFT_ORDER.map((l) => row.lifts[l].onFile)),
  };
}
