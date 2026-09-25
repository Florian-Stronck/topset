import type { BodyweightSummary } from "@/lib/bodyweight";
import { LOW_READINESS, READINESS_FIELDS, readinessScore, type ReadinessEntry } from "@/lib/readiness";
import { completionPct, dayStatus, daySets, DRIFT_MIN_ROWS, DRIFT_WARN, rpeDrift, type ComplianceRow, type DayStatus } from "@/lib/compliance";
import { liftOf } from "@/lib/intensity";
import { formatDate, ymdOf } from "@/lib/dates";
import { addDays } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type BlockSummary = {
  id: string;
  /** The program this phase belongs to. */
  programId: string;
  name: string;
  phase: string;
  startDate: Date;
  weeks: number;
  /** The maxes this block is calculated from, null on blocks written before they moved. */
  squat1RM: number | null;
  bench1RM: number | null;
  dead1RM: number | null;
  /** Rows with an exercise on them — a day's unnamed ghost row does not count. */
  rows: number;
  trainingDays: number;
};

export type AthleteSummary = {
  id: string;
  name: string;
  unit: "KG" | "LB";
  squat1RM: number | null;
  bench1RM: number | null;
  dead1RM: number | null;
  blocks: BlockSummary[];
};

export type BlockWindow = {
  start: Date;
  /** Exclusive: the day the block's last week finishes. */
  end: Date;
  status: "upcoming" | "active" | "done";
  /** 1-based week the block is in today, clamped to its length. */
  week: number;
  daysLeft: number;
};

/** Midnight today, so a block that ends this afternoon still counts as running. */
export function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function blockWindow(block: { startDate: Date; weeks: number }, today: Date): BlockWindow {
  const start = startOfDay(block.startDate);
  const end = new Date(start.getTime() + block.weeks * 7 * DAY_MS);
  const elapsed = Math.floor((startOfDay(today).getTime() - start.getTime()) / DAY_MS);

  const status = elapsed < 0 ? "upcoming" : elapsed >= block.weeks * 7 ? "done" : "active";
  const week = Math.min(block.weeks, Math.max(1, Math.floor(elapsed / 7) + 1));
  const daysLeft = Math.ceil((end.getTime() - startOfDay(today).getTime()) / DAY_MS);

  return { start, end, status, week, daysLeft };
}

/** The block an athlete is training right now, else the next one, else the last one. */
export function currentBlock(blocks: BlockSummary[], today: Date): BlockSummary | null {
  if (blocks.length === 0) return null;
  const active = blocks.find((b) => blockWindow(b, today).status === "active");
  if (active) return active;

  const upcoming = blocks
    .filter((b) => blockWindow(b, today).status === "upcoming")
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return upcoming[0] ?? blocks[0];
}

/** What a flag's one button does: open the plan, open Tracking, or hand out the link. */
export type FlagAction = "program" | "review" | "link";

export type Flag = {
  text: string;
  action: FlagAction;
};

/** How close to the end of a program the athlete is flagged for a new one — the coach's call. */
export function endingSoonDays(): number {
  return activeSettings().needsProgramWeeks * 7;
}

/**
 * Everything the overview should nag about, derived rather than stored: nothing here
 * needs a field the schema doesn't already have.
 */
export function flagsFor(
  athlete: AthleteSummary,
  today: Date,
  /** TARGET/tier pairs on the athlete's current block, for the missing-1RM check. */
  targets: { target: string; tier: string }[],
): Flag[] {
  const flags: Flag[] = [];

  if (athlete.blocks.length === 0) {
    return [{ text: t("No program yet"), action: "program" }];
  }

  const block = currentBlock(athlete.blocks, today);
  if (!block) return flags;

  const window = blockWindow(block, today);

  if (block.rows === 0) {
    flags.push({ text: t("“{name}” has no exercises yet", { name: block.name }), action: "program" });
  }

  if (window.status === "active" && window.daysLeft <= endingSoonDays()) {
    const later = athlete.blocks.some((b) => b.startDate.getTime() >= window.end.getTime());
    if (!later) {
      flags.push({
        text:
          window.daysLeft <= 0
            ? t("Program has run out — nothing programmed next")
            : t(window.daysLeft === 1 ? "Program ends in {n} day — nothing next" : "Program ends in {n} days — nothing next", { n: window.daysLeft }),
        action: "program",
      });
    }
  }

  if (window.status === "done") {
    flags.push({ text: t("No program running today"), action: "program" });
  }

  // The block's own maxes are what its target weights resolve against.
  const missing = missingMaxes(
    {
      squat1RM: block.squat1RM ?? athlete.squat1RM,
      bench1RM: block.bench1RM ?? athlete.bench1RM,
      dead1RM: block.dead1RM ?? athlete.dead1RM,
    },
    targets,
  );
  if (missing.length > 0) {
    flags.push({
      text: t("No 1RM for {lifts} — those rows show no target weight", { lifts: missing.join(", ") }),
      action: "program",
    });
  }

  return flags;
}

/** Lifts the current block programs off a 1RM the athlete doesn't have on file. */
export function missingMaxes(
  athlete: Pick<AthleteSummary, "squat1RM" | "bench1RM" | "dead1RM">,
  targets: { target: string; tier: string }[],
): string[] {
  const maxes = {
    squat: athlete.squat1RM,
    bench: athlete.bench1RM,
    dead: athlete.dead1RM,
  };
  const names = { squat: t("Squat"), bench: t("Bench"), dead: t("Deadlift") };

  const needed = new Set<keyof typeof maxes>();
  for (const { target, tier } of targets) {
    if (tier === "ACCESSORY") continue;
    const lift = liftOf(target);
    if (lift && maxes[lift] === null) needed.add(lift);
  }

  return [...needed].map((lift) => names[lift]);
}

export function formatRange(window: BlockWindow) {
  const last = new Date(window.end.getTime() - DAY_MS);
  return `${formatDate(window.start)} – ${formatDate(last)}`;
}

// --- the week, and how training is going ------------------------------------------------

/** A training day in the window the overview looks at, with its rows. */
export type WindowSession = {
  ymd: string;
  label: string;
  rows: ComplianceRow[];
};

export type WeekCell = { ymd: string; status: DayStatus; label: string | null; done: number; prescribed: number };

export type AthleteTraining = {
  /** The seven days of this calendar week. */
  cells: WeekCell[];
  /** Sets done of those due, this week so far and over the last four weeks. */
  weekPct: number | null;
  pct28: number | null;
  /** Logged against prescribed RPE over the last two weeks. */
  drift: { mean: number | null; n: number };
  /** Sessions in the last 7 days with nothing done. */
  missed7: number;
  /** Sessions due in the last 14 days, and the latest day anything was done. */
  due14: number;
  lastDone: string | null;
};

/** How many days back compliance looks. */
export const COMPLIANCE_DAYS = 28;

/**
 * One athlete's recent training, from the sessions around today: the week's seven cells,
 * compliance, RPE drift and missed sessions. `phases` are the date spans programs cover,
 * which tell a rest day from a day with nothing planned.
 */
export function athleteTraining(
  sessions: WindowSession[],
  phases: { start: string; end: string }[],
  week: string[],
  today: string,
): AthleteTraining {
  // A training day with nothing written on it yet asks nothing of the athlete.
  const sets = sessions.map((s) => ({ ...s, ...daySets(s.rows) })).filter((s) => s.prescribed > 0);
  const byDay = new Map(sets.map((s) => [s.ymd, s]));
  const covered = (ymd: string) => phases.some((p) => ymd >= p.start && ymd < p.end);
  // A session counts once its day has passed, or as soon as anything in it is done.
  const due = (s: (typeof sets)[number]) => s.ymd < today || (s.ymd === today && s.done > 0);

  const cells = week.map((ymd) => {
    const s = byDay.get(ymd) ?? null;
    return {
      ymd,
      status: dayStatus(ymd, today, s, covered(ymd)),
      label: s?.label ?? null,
      done: s?.done ?? 0,
      prescribed: s?.prescribed ?? 0,
    };
  });

  const since = (days: number) => addDays(today, -(days - 1));
  const recent = (days: number) => sets.filter((s) => s.ymd >= since(days) && s.ymd <= today);
  const weekDue = sets.filter((s) => week.includes(s.ymd) && due(s));
  const last14 = recent(14);

  return {
    cells,
    weekPct: completionPct(weekDue),
    pct28: completionPct(recent(COMPLIANCE_DAYS).filter(due)),
    drift: rpeDrift(last14.flatMap((s) => s.rows)),
    missed7: recent(7).filter((s) => s.ymd < today && s.done === 0).length,
    due14: last14.filter(due).length,
    lastDone: [...sets].reverse().find((s) => s.done > 0 && s.ymd <= today)?.ymd ?? null,
  };
}

/** A block's span on the calendar, `[start, end)` as `YYYY-MM-DD`. */
export function phaseSpan(block: { startDate: Date | string; weeks: number }): { start: string; end: string } {
  const start = ymdOf(block.startDate);
  return { start, end: addDays(start, block.weeks * 7) };
}

export type NextMeet = { name: string; days: number; weightClass: string | null; limit: number | null };

/**
 * What the athlete's recent training and bodyweight say the coach should look at: missed
 * sessions, RPE running away from the plan, an athlete who never checks in, and a
 * bodyweight above the class of the next meet.
 */
export function trainingFlags(
  training: AthleteTraining,
  {
    hasLink,
    linksOn,
    bodyweight,
    meet,
    unit,
    readiness = null,
    today,
  }: {
    hasLink: boolean;
    linksOn: boolean;
    bodyweight: BodyweightSummary;
    meet: NextMeet | null;
    unit: string;
    /** The latest readiness check-in, if any. */
    readiness?: ReadinessEntry | null;
    today?: string;
  },
): Flag[] {
  const flags: Flag[] = [];

  if (training.due14 >= 2 && training.lastDone === null) {
    flags.push(
      linksOn && !hasLink
        ? { text: t("Nothing logged in two weeks, and no check-in link yet"), action: "link" }
        : { text: t("Nothing logged in the last two weeks"), action: "review" },
    );
  } else if (training.missed7 >= 2) {
    flags.push({ text: t("Missed {n} sessions in the last 7 days", { n: training.missed7 }), action: "review" });
  }

  const { mean, n } = training.drift;
  if (mean !== null && n >= DRIFT_MIN_ROWS && Math.abs(mean) >= DRIFT_WARN) {
    flags.push({
      text:
        mean > 0
          ? t("RPE running {d} above plan over two weeks — maxes may be too high", { d: `+${mean}` })
          : t("RPE running {d} below plan over two weeks — room to push", { d: mean }),
      action: "review",
    });
  }

  // Low readiness in the last week, with the answers that pulled it down.
  const score = readiness ? readinessScore(readiness) : null;
  if (readiness && score !== null && score <= LOW_READINESS && (!today || readiness.day >= addDays(today, -6))) {
    const low = READINESS_FIELDS.filter((f) => (readiness[f.key] ?? 5) <= 2).map((f) => `${t(f.label).toLowerCase()} ${readiness[f.key]}`);
    const heavy = mean !== null && n >= DRIFT_MIN_ROWS && mean >= DRIFT_WARN;
    flags.push({
      text:
        t("Readiness {n}/5 on {date}", { n: score, date: formatDate(readiness.day) }) +
        (low.length > 0 ? ` — ${low.join(", ")}` : "") +
        (heavy ? ` · ${t("and RPE running above plan")}` : "") +
        (readiness.note ? ` · “${readiness.note}”` : ""),
      action: "review",
    });
  }

  const weight = bodyweight.avg7 ?? bodyweight.latest?.weight ?? null;
  if (meet && meet.limit !== null && weight !== null && weight > meet.limit) {
    flags.push({
      text: t("{w} {u} over the {class} class, {n} days out", {
        w: Math.round((weight - meet.limit) * 10) / 10,
        u: unit,
        class: meet.weightClass ?? String(meet.limit),
        n: meet.days,
      }),
      action: "review",
    });
  }

  return flags;
}
