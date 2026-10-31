"use client";

import { useCoachActions } from "@/components/CoachActions";
import { useTransition, type ReactNode } from "react";
import type { AttemptResult, MeetLift } from "@prisma/client";
import type { TopSet, TrainingFacts } from "@/app/competition/data";
import { NumberInput } from "@/components/cells";
import { ScoreToggle } from "@/components/competition/ScoreToggle";
import {
  best,
  currentAttempt,
  daysUntil,
  LIFT_LABEL,
  MEET_LIFTS,
  maxFor,
  meetScore,
  projectedTotal,
  scoreName,
  suggestion,
  THIRD_PLANS,
  thirdFor,
  total,
  totalLifts,
  totalOf,
  weightOf,
  type AttemptData,
  type MeetData,
  type ThirdPlan,
} from "@/lib/competition";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { LIFT_COLOR } from "@/lib/progress";
import type { AthleteData } from "@/lib/types";

const RESULT_CYCLE: Record<AttemptResult, AttemptResult> = {
  PENDING: "GOOD",
  GOOD: "MISS",
  MISS: "PENDING",
};

const RESULT_STYLE: Record<AttemptResult, string> = {
  PENDING: "border-border text-muted-2 hover:text-foreground",
  GOOD: "border-[color:var(--ok)]/50 bg-[color:var(--ok)]/10 text-[color:var(--ok)]",
  MISS: "border-accent/50 bg-accent-soft text-accent",
};

const RESULT_LABEL: Record<AttemptResult, string> = {
  PENDING: "—",
  GOOD: "GOOD",
  MISS: "MISS",
};

/** Keys on a focused result button, for calling attempts without the mouse. */
const RESULT_KEYS: Record<string, AttemptResult> = {
  g: "GOOD",
  m: "MISS",
  Backspace: "PENDING",
  Delete: "PENDING",
};

const NUMBER_LABEL = ["OPENER", "SECOND", "THIRD"];

const PLAN_LABEL: Record<ThirdPlan, string> = { safe: "Safe", planned: "Planned", push: "Push" };

const SPARK_KEY = { SQUAT: "squat", BENCH: "bench", DEADLIFT: "dead" } as const;

/** An opener is proven when it was lifted in training, or sits at 92% of the e1RM or under. */
const OPENER_SHARE = 0.92;

const pct = (weight: number | null, of: number | null) => (weight !== null && of ? Math.round((weight / of) * 100) : null);
const setText = (s: TopSet) => `${s.weight} × ${s.reps ?? 1}${s.rpe !== null ? ` @ ${s.rpe}` : ""}`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10}`;

export function AttemptsTab({
  athlete,
  meet,
  meets,
  training,
  weight,
  today,
  scoring,
  onScoring,
}: {
  athlete: AthleteData;
  meet: MeetData;
  meets: MeetData[];
  training: TrainingFacts | null;
  /** Bodyweight now, the class limit, and where the trend puts it at weigh-in. */
  weight: { current: number | null; limit: number | null; projected: number | null };
  today: Date;
  scoring: "dots" | "gl";
  onScoring: (kind: "dots" | "gl") => void;
}) {
  const { applyResultsAsMaxes, planFromMaxes, setThirds, updateMeet } = useCoachActions();
  const [, startTransition] = useTransition();
  const run = (action: () => Promise<unknown>) =>
    startTransition(() => {
      void action();
    });
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const upcoming = daysUntil(meet.date, today) >= 0;
  const attempts = meet.attempts;
  const current = currentAttempt(attempts);

  // Earlier meets: what the last one went like, and the best ever made on the platform.
  const before = meets.filter((m) => m.date < meet.date);
  const lastMeet = before.findLast((m) => m.attempts.some((a) => a.result !== "PENDING")) ?? null;
  const platformBest = (lift: MeetLift) => {
    const made = before.map((m) => best(m.attempts, lift)).filter((w): w is number => w !== null);
    return made.length ? Math.max(...made) : null;
  };
  const bestTotal = Math.max(0, ...before.map((m) => total(m.attempts) ?? 0)) || null;

  const bodyweight = meet.bodyweight ?? weight.current;
  const score = (sum: number | null) => meetScore(sum, bodyweight, athlete.sex, athlete.unit, scoring);
  const thirds = totalOf((l) => weightOf(attempts, l, 3));
  const pushed = totalOf((l) => thirdFor("push", maxFor(l, athlete), athlete.unit));
  const called = attempts.some((a) => a.result !== "PENDING");
  const actual = total(attempts);
  const projected = projectedTotal(attempts);
  const e1Total = training ? totalOf((l) => training.e1rm[l]) : null;
  const pastMax = training ? totalLifts().filter((l) => (training.e1rm[l] ?? 0) > (maxFor(l, athlete) ?? Infinity)) : [];
  const plan = THIRD_PLANS.find((p) =>
    MEET_LIFTS.every((l) => {
      const w = thirdFor(p, maxFor(l, athlete), athlete.unit);
      return w === null || w === weightOf(attempts, l, 3);
    }),
  );
  const hasMaxes = MEET_LIFTS.some((l) => maxFor(l, athlete) !== null);

  const thirdsScore = score(thirds);
  const goalNote =
    meet.goal === null
      ? { text: t("Set one to plan against"), tone: "text-muted-2" }
      : thirds !== null && thirds >= meet.goal
        ? { text: t("The planned thirds get there"), tone: "text-[color:var(--ok)]" }
        : pushed !== null && pushed >= meet.goal
          ? { text: t("Pushing every third gets there"), tone: "text-muted" }
          : pushed !== null
            ? { text: t("{n} {u} short with every third pushed", { n: Math.round((meet.goal - pushed) * 10) / 10, u: unit }), tone: "text-warn" }
            : { text: t("Needs a 1RM on every lift"), tone: "text-muted-2" };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {called ? (
          <Stat
            label={t("TOTAL")}
            value={actual === null ? "—" : String(actual)}
            unit={unit}
            note={
              current === null && score(actual) !== null
                ? `${score(actual)!.toFixed(1)} ${scoreName()}`
                : projected === null
                  ? t("needs a good lift on every totalled lift")
                  : t("{n} if every attempt left goes", { n: projected })
            }
          />
        ) : (
          <Stat
            label={t("PLANNED TOTAL")}
            value={thirds === null ? "—" : String(thirds)}
            unit={unit}
            note={[
              thirdsScore !== null ? `${thirdsScore.toFixed(1)} ${scoreName()}` : null,
              thirds !== null && bestTotal !== null ? t("{n} on the best total", { n: signed(thirds - bestTotal) }) : null,
            ]
              .filter(Boolean)
              .join(" · ") || t("needs a third on every lift")}
            tone={thirds !== null && bestTotal !== null && thirds > bestTotal ? "text-[color:var(--ok)]" : undefined}
          />
        )}
        <Stat
          label={t("GOAL")}
          value={
            <span data-focus="meet-goal" className="-ml-1 inline-block w-28 rounded border border-transparent hover:border-border">
              <NumberInput value={meet.goal} align="left" placeholder="—" className="!text-[22px] font-semibold" onCommit={(goal) => run(() => updateMeet(meet.id, { goal }))} />
            </span>
          }
          unit={unit}
          note={goalNote.text}
          tone={goalNote.tone}
        />
        <Stat
          label={t("TRAINING SAYS")}
          value={e1Total === null ? "—" : String(Math.round(e1Total * 2) / 2)}
          unit={t("{u} e1RM", { u: unit })}
          note={
            e1Total === null
              ? t("Not every lift logged in four weeks")
              : pastMax.length > 0
                ? t("{lifts} past the max on file", { lifts: pastMax.map((l) => t(LIFT_LABEL[l])).join(", ") })
                : t("Nothing past the maxes on file")
          }
          tone={pastMax.length > 0 ? "text-[color:var(--ok)]" : undefined}
        />
        {upcoming ? (
          <Stat
            label={t("BODYWEIGHT")}
            value={weight.current === null ? "—" : String(weight.current)}
            unit={weight.limit !== null ? `/ ${weight.limit} ${unit}` : unit}
            note={
              weight.current === null
                ? t("No weigh-ins yet")
                : weight.projected !== null
                  ? t("On trend {w} {u} at weigh-in", { w: weight.projected, u: unit })
                  : weight.limit !== null
                    ? t(weight.current > weight.limit ? "{n} {u} over the class" : "{n} {u} under the class", { n: Math.round(Math.abs(weight.current - weight.limit) * 10) / 10, u: unit })
                    : t("7-day average")
            }
            tone={weight.limit !== null && (weight.projected ?? weight.current ?? 0) > weight.limit ? "text-warn" : weight.limit !== null ? "text-[color:var(--ok)]" : undefined}
          />
        ) : (
          <Stat label={t("WEIGHED IN")} value={meet.bodyweight === null ? "—" : String(meet.bodyweight)} unit={unit} note={meet.weightClass ?? t("no class set")} />
        )}
      </div>

      <section aria-labelledby="h-attempts" className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <h2 id="h-attempts" className="text-[11px] tracking-[0.16em] text-muted-2">{t("ATTEMPTS")}</h2>
          <span className="text-[11px] text-muted-2">· {t("% of the 1RM · % of the training e1RM · G good, M miss on a focused result")}</span>
          <span className="flex-1" />
          {hasMaxes && (
            <>
              <span className="text-[12px] text-muted">{t("Every third")}</span>
              <div role="group" aria-label={t("Plan every third")} className="inline-flex overflow-hidden rounded-full border border-border text-[12px]">
                {THIRD_PLANS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={p === plan}
                    onClick={() => run(() => setThirds(meet.id, p))}
                    className={`px-3 py-1 ${p === plan ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-foreground"}`}
                  >
                    {t(PLAN_LABEL[p])}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => run(() => planFromMaxes(meet.id))}
            title={t("Fill the blank attempts from the athlete's 1RMs")}
            className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
          >
            {t("Plan from 1RMs")}
          </button>
        </div>

        <div className="overflow-x-auto px-4 pb-4 pt-3">
          <div className="min-w-[760px] space-y-2.5">
            {MEET_LIFTS.map((lift) => {
              const oneRM = maxFor(lift, athlete);
              const e1rm = training?.e1rm[lift] ?? null;
              const last = lastMeet ? lastMeet.attempts.filter((a) => a.lift === lift && a.result !== "PENDING") : [];
              const top = platformBest(lift);
              return (
                <div key={lift} className="grid grid-cols-[180px_repeat(3,minmax(0,1fr))] gap-2.5">
                  <div className="flex flex-col gap-1 py-1">
                    <span className="text-[14px] font-semibold">{t(LIFT_LABEL[lift])}</span>
                    <span className="text-[12px] text-muted">
                      {oneRM === null ? t("no 1RM on file") : `1RM ${oneRM}`}
                      {e1rm !== null && (
                        <>
                          {" · e1RM "}
                          <span className={oneRM !== null && e1rm > oneRM ? "font-medium text-[color:var(--ok)]" : "text-foreground"}>{Math.round(e1rm * 2) / 2}</span>
                        </>
                      )}
                    </span>
                    {training && <Spark values={training.weekly[lift]} max={oneRM} color={LIFT_COLOR[SPARK_KEY[lift]]} label={t("{lift} e1RM, last 8 weeks", { lift: t(LIFT_LABEL[lift]) })} />}
                    {lastMeet && last.length > 0 && (
                      <span className="text-[11px] text-muted-2">
                        {t("Last meet {best} · {made}/{called}", {
                          best: best(lastMeet.attempts, lift) ?? "—",
                          made: last.filter((a) => a.result === "GOOD").length,
                          called: last.length,
                        })}
                      </span>
                    )}
                  </div>
                  {[1, 2, 3].map((number) => {
                    const w = weightOf(attempts, lift, number);
                    const opener = training?.heaviest[lift] ?? null;
                    const note =
                      number === 1
                        ? opener && t("Heaviest lately: {set} · {date}", { set: setText(opener), date: formatDate(opener.ymd) })
                        : top !== null && w !== null
                          ? w > top
                            ? t("{n} on the platform best", { n: signed(w - top) })
                            : w === top
                              ? t("Ties the platform best")
                              : t("Platform best {n}", { n: top })
                          : null;
                    return (
                      <AttemptCell
                        key={number}
                        meet={meet}
                        lift={lift}
                        number={number}
                        oneRM={oneRM}
                        e1rm={e1rm}
                        athlete={athlete}
                        current={current?.lift === lift && current.number === number}
                        note={note}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {actual !== null && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
            <div className="text-[12px] text-muted">
              {totalLifts().map((lift) => `${t(LIFT_LABEL[lift])} ${best(attempts, lift)}`).join(" · ")} {unit}
            </div>
            <button
              type="button"
              onClick={() => run(() => applyResultsAsMaxes(meet.id))}
              className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
            >
              {t("Save results as the new 1RMs")}
            </button>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-stretch gap-4">
        <Scenarios athlete={athlete} meet={meet} score={score} scoring={scoring} onScoring={onScoring} bodyweight={bodyweight} />
        {upcoming && training && <OpenerCheck attempts={attempts} training={training} unit={unit} />}
      </div>
    </>
  );
}

function Stat({ label, value, unit, note, tone }: { label: string; value: ReactNode; unit?: string; note: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-[10px] tracking-[0.16em] text-muted-2">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-[12px] text-muted-2">{unit}</span>}
      </div>
      <div className={`text-[11.5px] ${tone ?? "text-muted-2"}`}>{note}</div>
    </div>
  );
}

/** The best weekly e1RM as a line, with the max on file dashed across it. */
function Spark({ values, max, color, label }: { values: (number | null)[]; max: number | null; color: string; label: string }) {
  const points = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (points.length < 2) return null;
  const all = [...points.map((p) => p[1]), ...(max !== null ? [max] : [])];
  const lo = Math.min(...all) - 1;
  const hi = Math.max(...all) + 1;
  const x = (i: number) => (i / (values.length - 1)) * 160;
  const y = (v: number) => 30 - ((v - lo) / (hi - lo)) * 26;
  return (
    <svg viewBox="0 0 160 32" preserveAspectRatio="none" className="h-8 w-full" role="img" aria-label={label}>
      {max !== null && <line x1={0} x2={160} y1={y(max)} y2={y(max)} stroke="var(--muted-2)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <polyline
        points={points.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function AttemptCell({
  meet,
  lift,
  number,
  oneRM,
  e1rm,
  athlete,
  current,
  note,
}: {
  meet: MeetData;
  lift: MeetLift;
  number: number;
  oneRM: number | null;
  e1rm: number | null;
  athlete: AthleteData;
  current: boolean;
  note: string | null;
}) {
  const { updateAttempt } = useCoachActions();
  const [, startTransition] = useTransition();
  const attempt =
    meet.attempts.find((a) => a.lift === lift && a.number === number) ??
    ({ id: `${meet.id}-${lift}-${number}`, lift, number, weight: null, result: "PENDING" } satisfies AttemptData);
  const hint = suggestion(meet.attempts, lift, number, oneRM, athlete.unit);
  const of1RM = pct(attempt.weight, oneRM);
  const ofE1 = pct(attempt.weight, e1rm);
  const choices = number === 3 && attempt.result === "PENDING" ? THIRD_PLANS.map((p) => ({ plan: p, weight: thirdFor(p, oneRM, athlete.unit) })) : [];

  const save = (patch: { weight?: number | null; result?: AttemptResult }) =>
    startTransition(() => {
      void updateAttempt(meet.id, lift, number, patch);
    });

  return (
    <div className={`flex flex-col gap-1 rounded-lg border bg-surface-2 p-1.5 ${current ? "border-accent/60 ring-2 ring-accent/30" : "border-border"}`}>
      <div className="flex items-baseline gap-2 px-1 pt-0.5">
        <span className="text-[10px] tracking-[0.14em] text-muted-2">{t(NUMBER_LABEL[number - 1])}</span>
        <span
          className={`ml-auto text-[11px] tabular-nums ${of1RM !== null && of1RM > 100 ? "text-[color:var(--ok)]" : "text-muted-2"}`}
          title={t("% of the 1RM · % of the training e1RM")}
        >
          {of1RM === null ? "" : ofE1 === null ? `${of1RM}%` : `${of1RM}% · ${ofE1}%`}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <NumberInput
            value={attempt.weight}
            align="left"
            placeholder={hint === null ? "—" : String(hint)}
            className="!text-[18px] font-semibold"
            onCommit={(weight) => save({ weight })}
          />
        </div>
        <button
          type="button"
          title={t("Pending → good → miss")}
          onClick={() => save({ result: RESULT_CYCLE[attempt.result] })}
          onKeyDown={(e) => {
            const result = RESULT_KEYS[e.key];
            if (!result || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            save({ result });
          }}
          className={`h-7 min-w-[60px] rounded border px-2 text-[11px] tracking-wider ${RESULT_STYLE[attempt.result]}`}
        >
          {RESULT_LABEL[attempt.result]}
        </button>
      </div>
      {choices.some((c) => c.weight !== null) && (
        <div role="group" aria-label={t("Third attempt")} className="flex gap-1">
          {choices.map(({ plan, weight }) =>
            weight === null ? null : (
              <button
                key={plan}
                type="button"
                aria-pressed={weight === attempt.weight}
                title={t(PLAN_LABEL[plan])}
                onClick={() => save({ weight })}
                className={`flex-1 rounded border py-0.5 text-[11px] tabular-nums ${
                  weight === attempt.weight ? "border-accent/60 bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {weight}
              </button>
            ),
          )}
        </div>
      )}
      {note && <div className="px-1 text-[11px] leading-snug text-muted-2">{note}</div>}
    </div>
  );
}

/** What the total comes to depending on how far the athlete gets, against the goal. */
function Scenarios({
  athlete,
  meet,
  score,
  scoring,
  onScoring,
  bodyweight,
}: {
  athlete: AthleteData;
  meet: MeetData;
  score: (sum: number | null) => number | null;
  scoring: "dots" | "gl";
  onScoring: (kind: "dots" | "gl") => void;
  bodyweight: number | null;
}) {
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const at = (n: number) => totalOf((l) => weightOf(meet.attempts, l, n));
  const plan = (p: ThirdPlan) => totalOf((l) => thirdFor(p, maxFor(l, athlete), athlete.unit));
  const rows = [
    { label: t("Openers only"), total: at(1), main: false },
    { label: t("Through seconds"), total: at(2), main: false },
    { label: t("Thirds as planned"), total: at(3), main: true },
    { label: t("Every third safe"), total: plan("safe"), main: false },
    { label: t("Every third pushed"), total: plan("push"), main: false },
  ].filter((r): r is { label: string; total: number; main: boolean } => r.total !== null);
  const top = Math.max(meet.goal ?? 0, ...rows.map((r) => r.total));
  const scored = score(1) !== null;

  return (
    <section aria-labelledby="h-totals" className="min-w-0 flex-[1.4_1_420px] rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="h-totals" className="text-[13px] font-semibold">{t("Total if…")}</h2>
        <span className="text-[11px] text-muted-2">
          {scored
            ? t("{score} at {w} {u}", { score: scoreName(), w: bodyweight ?? "—", u: unit })
            : !athlete.sex
              ? t("set the division on the athlete's card")
              : t("needs a bodyweight")}
        </span>
        <span className="flex-1" />
        <ScoreToggle scoring={scoring} onScoring={onScoring} />
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted-2">{t("Fill in the attempts to see what they add up to.")}</p>
      ) : (
        <div className="mt-2.5 space-y-1">
          {rows.map((r) => {
            const s = score(r.total);
            return (
              <div
                key={r.label}
                className={`grid grid-cols-[140px_minmax(0,1fr)_64px_56px] items-center gap-3 rounded-lg px-2 py-1.5 text-[12.5px] ${r.main ? "bg-surface-2" : ""}`}
              >
                <span className={r.main ? "font-medium" : "text-muted"}>{r.label}</span>
                <span className="relative h-2 rounded bg-surface-2">
                  <span
                    className={`absolute inset-y-0 left-0 rounded ${r.main ? "bg-accent" : "bg-muted-2/60"}`}
                    style={{ width: `${(r.total / top) * 100}%` }}
                  />
                  {meet.goal !== null && <span className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `${(meet.goal / top) * 100}%` }} />}
                </span>
                <span className="text-right font-semibold tabular-nums">{r.total}</span>
                <span className="text-right tabular-nums text-muted">{s === null ? "" : s.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}
      {meet.goal !== null && rows.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-2">
          <span className="inline-block h-3 w-0.5 bg-foreground" />
          {t("Goal {n} {u}", { n: meet.goal, u: unit })}
        </div>
      )}
    </section>
  );
}

/** Each opener against the heaviest training of the last six weeks: proven, or a guess. */
function OpenerCheck({ attempts, training, unit }: { attempts: AttemptData[]; training: TrainingFacts; unit: string }) {
  const lines = MEET_LIFTS.flatMap((lift) => {
    const opener = weightOf(attempts, lift, 1);
    if (opener === null) return [];
    const top = training.heaviest[lift];
    const e1rm = training.e1rm[lift];
    const ok = (top !== null && top.weight >= opener) || (e1rm !== null && opener <= e1rm * OPENER_SHARE);
    const share = pct(opener, e1rm);
    return [
      {
        lift,
        opener,
        ok,
        text: [
          top ? t("{set} on {date}", { set: setText(top), date: formatDate(top.ymd) }) : t("Nothing logged in six weeks"),
          share !== null ? t("opener at {p}% of the e1RM", { p: share }) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    ];
  });

  return (
    <section aria-labelledby="h-openers" className="min-w-0 flex-[1_1_320px] rounded-xl border border-border bg-surface p-4">
      <h2 id="h-openers" className="text-[13px] font-semibold">{t("Opener check")}</h2>
      <p className="mt-0.5 text-[11px] text-muted-2">{t("The heaviest set of the last six weeks against each opener")}</p>
      {lines.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted-2">{t("No openers yet.")}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {lines.map((l) => (
            <li key={l.lift} className="flex gap-2.5 text-[12.5px] leading-snug">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${l.ok ? "bg-[color:var(--ok)]" : "bg-warn"}`} />
              <span>
                <span className="font-semibold">
                  {t(LIFT_LABEL[l.lift])} {l.opener} {unit}
                </span>{" "}
                <span className="text-muted">{l.text}</span>
                {!l.ok && <span className="block text-[11.5px] text-warn">{t("Nothing in training proves it yet.")}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
