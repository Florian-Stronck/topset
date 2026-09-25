import type { Tier } from "@prisma/client";
import { LOW_READINESS, readinessOf, scaleScore, type CheckinAnswerData, type CheckinQuestionData } from "@/lib/checkins";
import { daySets, rpeDrift, type DayStatus, type OffPlan } from "@/lib/compliance";
import { keyOf, type ExerciseHistory, type ExerciseLog, type HistoryBlock } from "@/lib/exercise-history";
import { estimate1RM, liftOf } from "@/lib/intensity";
import { addDays, dateOfDay } from "@/lib/schedule";
import { rpeOf } from "@/lib/setlog";
import type { AthleteData, BlockData, DayData, RowData } from "@/lib/types";
import { activeSettings } from "@/lib/settings";

export type WeekStat = {
  week: number;
  /** Rows carrying a prescription that week. */
  prescribed: number;
  /** Of those, how many have a logged weight. */
  logged: number;
  /** sets × reps × logged weight, summed. */
  tonnage: number;
  /** Mean (performed RPE − prescribed RPE); positive means it ran heavier than planned. */
  rpeDelta: number | null;
  /** Sets done of the sets prescribed, for the week's completion bar. */
  setsDone: number;
  setsPrescribed: number;
};

export type LiftBest = {
  lift: "squat" | "bench" | "dead";
  label: string;
  exercise: string;
  week: number;
  weight: number;
  reps: number;
  rpe: number | null;
  e1rm: number;
  /** The 1RM currently on file, for the comparison. */
  onFile: number | null;
  /** Beats the 1RM on file, by the coach's definition of a PR. */
  pr: boolean;
};

/**
 * A PR is either an estimated 1RM above the one on file, or — stricter — a weight
 * actually lifted above it, depending on the coach's setting.
 */
export function isPr(best: { e1rm: number; weight: number }, onFile: number | null): boolean {
  if (onFile === null) return false;
  return activeSettings().pr.basis === "weight" ? best.weight > onFile : best.e1rm > onFile;
}

const LIFT_LABEL = { squat: "Squat", bench: "Bench", dead: "Deadlift" } as const;

function programmed(row: RowData) {
  return row.exercise.trim() !== "";
}

export function weekStats(block: BlockData): WeekStat[] {
  return block.weeks.map((week) => {
    let prescribed = 0;
    let logged = 0;
    let tonnage = 0;
    const compared: RowData[] = [];

    for (const day of week.days) {
      if (day.rest) continue;
      for (const row of day.rows) {
        if (!programmed(row)) continue;

        if (row.intensity !== null || row.sets !== null) prescribed++;

        if (row.actualWeight !== null) {
          logged++;
          tonnage += (row.sets ?? 0) * (row.reps ?? 0) * row.actualWeight;
        }

        compared.push(row);
      }
    }

    // An RPE or RIR prescription is compared like for like; nothing else says how hard.
    const drift = rpeDrift(compared);
    const sets = daySets(week.days.filter((d) => !d.rest).flatMap((d) => d.rows));

    return {
      week: week.order,
      prescribed,
      logged,
      tonnage: Math.round(tonnage),
      rpeDelta: drift.mean,
      setsDone: sets.done,
      setsPrescribed: sets.prescribed,
    };
  });
}

/**
 * Best estimated 1RM per lift from what was actually logged. Only PRIMARY rows count:
 * a variation is trained off a lower max, so reading a competition 1RM out of a paused
 * squat would quietly understate the athlete.
 */
export function bestEstimates(block: BlockData, athlete: AthleteData): LiftBest[] {
  const best = new Map<LiftBest["lift"], LiftBest>();
  const onFile = {
    squat: athlete.squat1RM,
    bench: athlete.bench1RM,
    dead: athlete.dead1RM,
  };

  for (const week of block.weeks) {
    for (const day of week.days) {
      if (day.rest) continue;
      for (const row of day.rows) {
        if (!programmed(row) || row.tier !== "PRIMARY") continue;
        const lift = liftOf(row.target);
        if (!lift) continue;

        if (row.actualWeight === null || row.reps === null) continue;
        const e1rm = estimate1RM(row.actualWeight, row.reps, row.performedRpe, athlete.unit);
        if (e1rm === null) continue;

        const current = best.get(lift);
        if (current && current.e1rm >= e1rm) continue;

        best.set(lift, {
          lift,
          label: LIFT_LABEL[lift],
          exercise: row.exercise,
          week: week.order,
          weight: row.actualWeight,
          reps: row.reps,
          rpe: row.performedRpe,
          e1rm,
          onFile: onFile[lift],
          pr: isPr({ e1rm, weight: row.actualWeight }, onFile[lift]),
        });
      }
    }
  }

  return [...best.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// --- Review: one line per exercise, one card per session --------------------------------

/** The heaviest set the athlete finished on a row, or the row's own logged weight. */
export type TopSet = { weight: number; reps: number | null; rpe: number | null };

export function topSetOf(row: Pick<RowData, "logs" | "actualWeight" | "reps" | "performedRpe">): TopSet | null {
  let top: TopSet | null = null;
  for (const log of row.logs ?? []) {
    if (!log.done || log.weight === null) continue;
    const rpe = rpeOf(log);
    if (!top || log.weight > top.weight || (log.weight === top.weight && (rpe ?? 0) > (top.rpe ?? 0))) {
      top = { weight: log.weight, reps: log.reps ?? row.reps, rpe };
    }
  }
  if (top) return top;
  return row.actualWeight === null ? null : { weight: row.actualWeight, reps: row.reps, rpe: row.performedRpe };
}

/** The same exercise the last time it was logged before a session. */
export type PreviousLog = { ymd: string; weight: number; reps: number | null; rpe: number | null; e1rm: number | null };

/**
 * For every row of a phase, the last time its exercise was logged on an earlier day, in
 * this program or any before it — what "vs last week" compares against.
 */
export function previousLogs(block: Pick<BlockData, "startDate" | "weeks">, history: ExerciseHistory[]): Record<string, PreviousLog> {
  const byName = new Map(history.map((h) => [keyOf(h.name), h.logs]));
  const out: Record<string, PreviousLog> = {};
  for (const week of block.weeks) {
    for (const day of week.days) {
      const ymd = dateOfDay(block.startDate, week.order, day.index);
      for (const row of day.rows) {
        if (!programmed(row)) continue;
        const logs = byName.get(keyOf(row.exercise));
        if (!logs) continue;
        let last: ExerciseLog | null = null;
        for (const log of logs) if (log.ymd < ymd && (!last || log.ymd >= last.ymd)) last = log;
        if (last) out[row.id] = { ymd: last.ymd, weight: last.weight, reps: last.reps, rpe: last.rpe, e1rm: last.e1rm };
      }
    }
  }
  return out;
}

/**
 * Whether a session wants the coach's eye: something was logged or answered, and either
 * it was never marked reviewed or more came in after it was. Times are ISO strings.
 */
export function needsReview(hasWork: boolean, lastActivity: string | null, reviewedAt: string | null): boolean {
  if (!hasWork) return false;
  if (reviewedAt === null) return true;
  return lastActivity !== null && lastActivity > reviewedAt;
}

/** Whether anything was done on a session, and when the athlete last logged or answered for it. */
export function sessionActivity(day: Pick<DayData, "rows">, answers: Pick<CheckinAnswerData, "updatedAt">[]): { hasWork: boolean; last: string | null } {
  const logs = day.rows.flatMap((r) => r.logs ?? []).filter((l) => l.done);
  const hasWork = logs.length > 0 || day.rows.some((r) => r.actualWeight !== null);
  return { hasWork, last: latestOf([...logs.map((l) => l.loggedAt), ...answers.map((a) => a.updatedAt)]) };
}

/** The sessions of a phase waiting for the coach's review. */
export function unreviewedDays(block: Pick<BlockData, "startDate" | "weeks">, answers: CheckinAnswerData[]): Set<string> {
  const out = new Set<string>();
  for (const week of block.weeks) {
    for (const day of week.days) {
      if (day.rest) continue;
      const ymd = dateOfDay(block.startDate, week.order, day.index);
      const { hasWork, last } = sessionActivity(day, answers.filter((a) => a.day === ymd));
      if (needsReview(hasWork, last, day.reviewedAt ?? null)) out.add(day.id);
    }
  }
  return out;
}

/** The newest of some ISO times, or null. */
export function latestOf(times: (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const t of times) if (t && (out === null || t > out)) out = t;
  return out;
}

export type ReviewFilter = "all" | "unreviewed" | "offplan" | "missed" | "prs";
export type LiftFilter = "all" | "main" | "variations" | "accessories";

export const REVIEW_FILTERS: ReviewFilter[] = ["all", "unreviewed", "offplan", "missed", "prs"];
export const LIFT_FILTERS: LiftFilter[] = ["all", "main", "variations", "accessories"];

/** Competition lifts and their back-off sets, the lifts built around them, and the rest. */
export function tierGroup(tier: Tier): Exclude<LiftFilter, "all"> {
  if (tier === "PRIMARY" || tier === "BACKOFF") return "main";
  if (tier === "SECONDARY" || tier === "VARIATION") return "variations";
  return "accessories";
}

/** What a row carries for the filters. */
export type RowFacts = { tier: Tier; off: OffPlan | null; pr: boolean };

export function keepRow(row: RowFacts, filter: ReviewFilter, lifts: LiftFilter): boolean {
  if (lifts !== "all" && tierGroup(row.tier) !== lifts) return false;
  if (filter === "offplan") return row.off !== null;
  if (filter === "missed") return row.off?.reasons.includes("missed") ?? false;
  if (filter === "prs") return row.pr;
  return true;
}

/** What a session carries for the filters and the attention bar. */
export type SessionFacts = {
  status: DayStatus;
  unreviewed: boolean;
  /** Its rows that pass the filters. */
  kept: number;
  readiness: number | null;
};

export function keepSession(session: SessionFacts, filter: ReviewFilter, showUpcoming: boolean): boolean {
  if (session.kept === 0) return false;
  // Today stays either way: it is the session most likely to be under way.
  if (!showUpcoming && session.status === "upcoming") return false;
  if (filter === "unreviewed") return session.unreviewed;
  return true;
}

export type Attention = { unreviewed: number; missed: number; offPlan: number; prs: number; lowReadiness: number };

/** The week in counts: sessions to review or missed, rows off plan or flagged as PRs, rough days. */
export function attentionOf(sessions: { facts: SessionFacts; rows: RowFacts[] }[]): Attention {
  const out: Attention = { unreviewed: 0, missed: 0, offPlan: 0, prs: 0, lowReadiness: 0 };
  for (const { facts, rows } of sessions) {
    if (facts.unreviewed) out.unreviewed++;
    if (facts.status === "missed") out.missed++;
    if (facts.readiness !== null && facts.readiness <= LOW_READINESS) out.lowReadiness++;
    for (const row of rows) {
      if (row.off && !row.off.reasons.includes("missed")) out.offPlan++;
      if (row.pr) out.prs++;
    }
  }
  return out;
}

export type ReadinessPoint = { day: string; score: number | null; byQuestion: Record<string, number | null> };

/** Every day from `from` to `to`, with the day's readiness and each scale question's 1–5 reading. */
export function readinessSeries(questions: CheckinQuestionData[], answers: CheckinAnswerData[], from: string, to: string): ReadinessPoint[] {
  const scales = questions.filter((q) => q.kind === "SCALE");
  const byDay = new Map<string, CheckinAnswerData[]>();
  for (const a of answers) if (a.day >= from && a.day <= to) byDay.set(a.day, [...(byDay.get(a.day) ?? []), a]);
  const out: ReadinessPoint[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const that = byDay.get(day) ?? [];
    const byQuestion: Record<string, number | null> = {};
    for (const q of scales) {
      const a = that.find((x) => x.questionId === q.id);
      byQuestion[q.id] = a ? scaleScore(q, a.value) : null;
    }
    out.push({ day, score: readinessOf(questions, that).score, byQuestion });
  }
  return out;
}

/**
 * RPE against the plan for each session in a stretch of days: the mean of logged minus
 * prescribed, over the rows that have both. For putting beside how ready the athlete felt.
 */
export function sessionDrift(blocks: HistoryBlock[], from: string, to: string): { ymd: string; drift: number }[] {
  const out: { ymd: string; drift: number }[] = [];
  for (const block of blocks) {
    for (const week of block.weeks) {
      for (const day of week.days) {
        if (day.rest) continue;
        const ymd = dateOfDay(block.startDate, week.order, day.index);
        if (ymd < from || ymd > to) continue;
        const { mean } = rpeDrift(day.rows);
        if (mean !== null) out.push({ ymd, drift: mean });
      }
    }
  }
  return out.sort((a, b) => a.ymd.localeCompare(b.ymd));
}
