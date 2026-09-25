"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { updateAthlete, updateCell } from "@/app/programming/actions";
import { syncNow } from "@/app/sync-actions";
import { NumberInput, TextInput } from "@/components/cells";
import { AthleteLinkButton } from "@/components/AthleteLink";
import { BodyweightPanel } from "@/components/BodyweightPanel";
import { CheckinPanel } from "@/components/CheckinPanel";
import { ExerciseHistoryPanel } from "@/components/ExerciseHistoryPanel";
import { VolumeTable } from "@/components/VolumeTable";
import { LiftChart } from "@/components/LiftChart";
import { RowVideos } from "@/components/RowVideos";
import type { BodyweightEntry } from "@/lib/bodyweight";
import type { ExerciseHistory } from "@/lib/exercise-history";
import { formatAnswer, LOW_READINESS, readinessOf, type CheckinAnswerData, type CheckinQuestionData } from "@/lib/checkins";
import { CheckinIcon, Trophy } from "@/components/CheckinIcon";
import type { AthleteCheckins } from "@/lib/queries";
import { offPlan, rpeDelta, type OffPlan } from "@/lib/compliance";
import { formatPrescription, maxesOf, resolveDay } from "@/lib/intensity";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import type { LiftSeries } from "@/lib/progress";
import { formatEffort } from "@/lib/setlog";
import { bestEstimates, weekStats } from "@/lib/tracking";
import type { VideoFile } from "@/lib/videos";
import { WEEKDAYS, type AthleteData, type BlockData, type Prescription, type RowData } from "@/lib/types";
import { weekdayOf, weekdayOfDay } from "@/lib/dates";
import { dateOfDay } from "@/lib/schedule";
import { useSettings } from "@/components/SettingsProvider";
import { fresh, useCommands, type Command } from "@/lib/commands";
import { t } from "@/lib/i18n";

// Notes keep room to read; on a narrow window each day scrolls sideways instead.
const COLS = "180px 150px 90px 100px 72px minmax(140px, 1fr) 200px";

export function TrackingSheet({
  block: initialBlock,
  phases,
  programs,
  programName,
  athlete,
  hasLink,
  neighbours,
  initialWeek,
  today,
  series,
  videos,
  bodyweight,
  checkins,
  history,
  meet,
}: {
  block: BlockData;
  phases: { id: string; phase: string }[];
  programs: { id: string; name: string; firstPhaseId: string | null }[];
  programName: string;
  athlete: AthleteData;
  /** Whether the athlete has a check-in link out. */
  hasLink: boolean;
  /** The athletes either side on the roster, to step through without going back. */
  neighbours: { prev: { id: string; name: string } | null; next: { id: string; name: string } | null };
  /** The week to open on: from the link, else the one the phase is in today. */
  initialWeek: number;
  /** `YYYY-MM-DD` on this computer, for telling a missed session from one still to come. */
  today: string;
  series: Record<"prescribed" | "estimated", LiftSeries[]>;
  /** Videos attached on this computer, per row. */
  videos: Record<string, VideoFile[]>;
  /** Every weigh-in on file, oldest first. */
  bodyweight: BodyweightEntry[];
  /** The athlete's check-in questions, archived too, and every answer on file. */
  checkins: AthleteCheckins;
  /** Every logged exercise across all programs, most logged first. */
  history: ExerciseHistory[];
  meet: { name: string; day: string; weightClass: string | null; limit: number | null } | null;
}) {
  const [block, setBlock] = useState(initialBlock);
  const prHighlight = useSettings().settings.pr.highlight;
  const [synced, setSynced] = useState(initialBlock);
  const [week, setWeek] = useState(initialWeek);
  const [offOnly, setOffOnly] = useState(false);
  const [chartMode, setChartMode] = useState<"prescribed" | "estimated">("prescribed");
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (synced !== initialBlock) {
    if (synced.id !== initialBlock.id) setWeek(initialWeek);
    setSynced(initialBlock);
    setBlock(initialBlock);
  }

  const activeWeek = Math.min(week, block.weeks.length);
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const maxes = maxesOf(block, athlete);
  const stats = weekStats(block);
  const bests = bestEstimates(block, athlete);
  const current = stats[activeWeek - 1];
  const days = block.weeks.find((w) => w.order === activeWeek)?.days ?? [];
  const anyLogged = block.weeks.some((w) => w.days.some((d) => d.rows.some((r) => r.actualWeight !== null || (r.logs?.length ?? 0) > 0)));

  // Each row of the week, checked against the plan once, for the edges and the filter.
  const checked = days.map((day) => {
    const resolved = resolveDay(day.rows, maxes);
    const past = dateOfDay(block.startDate, activeWeek, day.index) < today;
    const rows = day.rows
      .filter((r) => r.exercise.trim() !== "")
      .map((row) => {
        const target = resolved.get(row.id)?.weight ?? null;
        return { row, target, off: day.rest ? null : offPlan(row, target, past) };
      });
    return { day, rows };
  });
  const answersByDay = new Map<string, CheckinAnswerData[]>();
  for (const a of checkins.answers) answersByDay.set(a.day, [...(answersByDay.get(a.day) ?? []), a]);
  const weekDates = Array.from({ length: 7 }, (_, i) => dateOfDay(block.startDate, activeWeek, i));
  const offCount = checked.reduce((n, d) => n + d.rows.filter((r) => r.off).length, 0);

  const weekCount = block.weeks.length;
  const commands = useMemo<Command[]>(() => {
    const track = (blockId: string) => router.push(`/tracking?athlete=${athlete.id}&block=${blockId}`);
    const at = phases.findIndex((p) => p.id === block.id);
    const refresh = () =>
      startTransition(async () => {
        await syncNow();
        router.refresh();
      });
    return [
      {
        id: "week-prev",
        group: "Week",
        title: t("Previous week"),
        run: () => setWeek((w) => Math.max(1, Math.min(w, weekCount) - 1)),
      },
      {
        id: "week-next",
        group: "Week",
        title: t("Next week"),
        run: () => setWeek((w) => Math.min(weekCount, w + 1)),
      },
      ...Array.from({ length: weekCount }, (_, i): Command => ({
        id: `week-${i + 1}`,
        group: "Week",
        title: t("Go to week {n}", { n: i + 1 }),
        kind: "week",
        run: () => setWeek(i + 1),
      })),
      {
        id: "track-offplan",
        group: "Tracking",
        title: offOnly ? t("Show every set") : t("Show only off-plan sets"),
        keywords: "filter missed compliance",
        run: () => setOffOnly((on) => !on),
      },
      {
        id: "track-chart",
        group: "Tracking",
        title: chartMode === "prescribed" ? t("Chart the estimated 1RMs") : t("Chart the prescribed weights"),
        keywords: "graph e1rm lift chart",
        run: () => setChartMode((m) => (m === "prescribed" ? "estimated" : "prescribed")),
      },
      {
        id: "track-link",
        group: "Tracking",
        title: t("Check-in link for {name}", { name: athlete.name }),
        keywords: "qr phone share athlete app",
        run: () => router.push(fresh(`/athletes?link=${athlete.id}`)),
      },
      {
        id: "refresh",
        group: "Sync",
        title: t("Refresh what athletes logged"),
        keywords: "reload sync sets phone",
        run: refresh,
      },
      {
        id: "phase-prev",
        group: "Phase",
        title: t("Previous phase"),
        run: () => at > 0 && track(phases[at - 1].id),
      },
      {
        id: "phase-next",
        group: "Phase",
        title: t("Next phase"),
        run: () => at >= 0 && at < phases.length - 1 && track(phases[at + 1].id),
      },
      ...phases
        .filter((p) => p.id !== block.id)
        .map((p): Command => ({
          id: `open-phase-${p.id}`,
          group: "Phase",
          title: t("Track phase {name}", { name: p.phase }),
          kind: "place",
          run: () => track(p.id),
        })),
      ...programs
        .filter((p) => p.id !== block.program.id && p.firstPhaseId)
        .map((p): Command => ({
          id: `open-program-${p.id}`,
          group: "Program",
          title: t("Track {name}", { name: p.name }),
          kind: "place",
          run: () => track(p.firstPhaseId!),
        })),
      {
        id: "go-programming",
        group: "Go",
        title: t("Programming for this phase"),
        kind: "place",
        run: () => router.push(`/programming?athlete=${athlete.id}&phase=${block.id}`),
      },
    ];
  }, [athlete, block.id, block.program.id, chartMode, offOnly, phases, programs, router, weekCount]);
  // Above the sidebar's: "Programming" here opens this very phase.
  useCommands("tracking", commands, 1);

  function patch(rowId: string, patchData: Partial<Prescription>) {
    setBlock((b) => ({
      ...b,
      weeks: b.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) => ({
          ...d,
          rows: d.rows.map((r) => (r.id === rowId ? { ...r, ...patchData } : r)),
        })),
      })),
    }));
    startTransition(() => {
      void updateCell(rowId, patchData);
    });
  }

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div style={{ maxWidth: SHELL_MAX_WIDTH }} className="mx-auto w-full px-6 py-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{t("Tracking")}</h1>
            <div className="mt-1 flex items-center gap-1">
              <AthleteStep to={neighbours.prev} dir="left" />
              <span className="text-[13px] font-medium">{athlete.name}</span>
              <AthleteStep to={neighbours.next} dir="right" />
              <span className="ml-1 text-[12px] text-muted">
                {programName} · {t("what was actually lifted against what was prescribed")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
              <select
                value={block.program.id}
                onChange={(e) => {
                  const next = programs.find((p) => p.id === e.target.value);
                  if (next?.firstPhaseId) {
                    router.push(`/tracking?athlete=${athlete.id}&block=${next.firstPhaseId}`);
                  }
                }}
                className="cursor-pointer bg-transparent text-[12px] outline-none"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center rounded-full border border-border bg-surface px-3 py-1.5">
              <select
                value={block.id}
                onChange={(e) =>
                  router.push(`/tracking?athlete=${athlete.id}&block=${e.target.value}`)
                }
                className="cursor-pointer bg-transparent text-[12px] outline-none"
              >
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.phase}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() =>
                startTransition(async () => {
                  await syncNow();
                  router.refresh();
                })
              }
              title={t("Load what the athlete logged since this page opened")}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
            >
              {t("Refresh")}
            </button>
            <Link
              href={`/programming?athlete=${athlete.id}&phase=${block.id}`}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
            >
              {t("Programming")}
            </Link>
          </div>
        </div>

        {!anyLogged && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t("Nothing logged in this phase yet")}</div>
              <div className="text-[12px] text-muted">
                {t("Send {name} their check-in link and every set they log on their phone shows up here.", { name: athlete.name })}
              </div>
            </div>
            <AthleteLinkButton athleteId={athlete.id} name={athlete.name} hasLink={hasLink} />
          </div>
        )}

        <div className="mt-6">
          <LiftChart series={series} unit={unit} mode={chartMode} onMode={setChartMode} />
        </div>

        <WeekTabs stats={stats} active={activeWeek} onSelect={setWeek} />

        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("WEEK {n}", { n: activeWeek })}</h2>
            {current && (
              <span className="text-[11px] text-muted-2">
                {t("{done}/{of} logged", { done: current.logged, of: current.prescribed })}
                {current.rpeDelta !== null &&
                  ` · ${t("RPE ran {delta} vs prescribed", { delta: `${current.rpeDelta > 0 ? "+" : ""}${current.rpeDelta}` })}`}
                {current.tonnage > 0 && ` · ${current.tonnage.toLocaleString()} ${unit}`}
              </span>
            )}
            <label
              className={`ml-auto flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                offOnly ? "border-warn/60 bg-surface-2 text-foreground" : "border-border text-muted hover:text-foreground"
              }`}
            >
              <input type="checkbox" checked={offOnly} onChange={(e) => setOffOnly(e.target.checked)} className="accent-[var(--warn)]" />
              {t("Off-plan only")}
              <span className="tabular-nums text-muted-2">{offCount}</span>
            </label>
          </div>

          <WeekCheckins
            questions={checkins.questions}
            answersByDay={answersByDay}
            dates={weekDates}
            sessionDates={new Set(checked.filter((d) => !d.day.rest && d.rows.length > 0).map((d) => dateOfDay(block.startDate, activeWeek, d.day.index)))}
          />

          <div className="mt-2 space-y-4">
            {offOnly && offCount === 0 && (
              <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-2">
                {t("Nothing off plan this week.")}
              </div>
            )}
            {checked.map(({ day, rows: all }) => {
              const rows = offOnly ? all.filter((r) => r.off) : all;
              if (day.rest || rows.length === 0) return null;

              return (
                <div key={day.id} className="overflow-x-auto rounded-xl border border-border">
                  <div className="sticky left-0 flex items-center gap-2 bg-surface-2 px-4 py-2">
                    <span className="text-[13px] font-semibold">{day.label}</span>
                    <span className="text-[11px] text-muted-2">{t(WEEKDAYS[weekdayOfDay(block.startDate, day.index)])}</span>
                    <CheckinNote questions={checkins.questions} answers={answersByDay.get(dateOfDay(block.startDate, activeWeek, day.index)) ?? []} />
                  </div>

                  <div
                    className="grid min-w-full w-fit border-b border-border bg-surface px-4 py-2 text-[11px] tracking-[0.12em] text-muted-2"
                    style={{ gridTemplateColumns: COLS }}
                  >
                    <span>{t("EXERCISE")}</span>
                    <span>{t("PRESCRIBED")}</span>
                    <span className="text-right">{t("TARGET")}</span>
                    <span className="text-center">{t("LOGGED")}</span>
                    <span className="text-center">{t("RPE")}</span>
                    <span className="pl-2">{t("ATHLETE NOTES")}</span>
                    <span className="pl-2">{t("VIDEOS")}</span>
                  </div>

                  {rows.map(({ row, target, off }) => {
                    const cell = row;
                    const done = cell?.actualWeight !== null && cell?.actualWeight !== undefined;

                    return (
                      <div
                        key={row.id}
                        className={`grid min-w-full w-fit items-center border-b border-l-[3px] border-b-border/60 px-4 pl-[13px] last:border-b-0 ${
                          done ? "bg-surface" : "bg-surface/40"
                        } ${
                          row.logs?.some((l) => l.pr)
                            ? "border-l-pr"
                            : off?.level === "miss"
                              ? "border-l-miss"
                              : off
                                ? "border-l-warn"
                                : "border-l-transparent"
                        }`}
                        style={{ gridTemplateColumns: COLS }}
                      >
                        <span className="min-w-0 py-2">
                          <span className="flex items-center gap-1.5 text-[12px] font-medium">
                            <span className="truncate">{row.exercise}</span>
                            {row.logs?.some((l) => l.pr) && (
                              <span
                                title={t("The athlete flagged a PR")}
                                className="flex shrink-0 items-center gap-0.5 rounded bg-pr/15 px-1 py-px text-[9px] font-bold tracking-wider text-pr"
                              >
                                <Trophy size={9} /> {t("PR")}
                              </span>
                            )}
                          </span>
                          {off && <OffPlanNote off={off} row={row} target={target} />}
                        </span>
                        <span className="truncate text-[12px] text-muted">
                          {cell
                            ? `${cell.sets ?? "—"} × ${cell.reps ?? "—"} @ ${formatPrescription(cell, athlete.unit)}`
                            : "—"}
                        </span>
                        <span className="text-right text-[12px] text-muted-2">
                          {target === null ? "—" : `${target} ${unit}`}
                        </span>

                        <div className="px-1">
                          <NumberInput
                            value={cell?.actualWeight ?? null}
                            placeholder={target === null ? "—" : String(target)}
                            onCommit={(v) => patch(row.id, { actualWeight: v })}
                            className={done ? "!text-foreground" : ""}
                          />
                        </div>
                        <div className="px-1">
                          <NumberInput
                            value={cell?.performedRpe ?? null}
                            onCommit={(v) => patch(row.id, { performedRpe: v })}
                          />
                        </div>
                        <div className="pl-1">
                          <TextInput
                            value={cell?.athleteNotes ?? null}
                            placeholder={t("how did it feel")}
                            className="!text-[11px] italic text-muted"
                            onCommit={(v) => patch(row.id, { athleteNotes: v })}
                          />
                        </div>
                        <div className="py-1 pl-2">
                          <RowVideos rowId={row.id} exercise={row.exercise} videos={videos[row.id] ?? []} />
                        </div>
                        {row.logs && row.logs.length > 0 && <SetLines logs={row.logs} sets={row.sets} unit={unit} />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
        <div className="mt-7">
          <CheckinPanel questions={checkins.questions} answers={checkins.answers} today={today} />
        </div>

        <VolumeTable block={block} activeWeek={activeWeek} />

        <ExerciseHistoryPanel history={history} unit={unit} />

        {bests.length > 0 && (
          <section className="mt-7">
            <h2 className="text-[11px] tracking-[0.16em] text-muted-2">
              {t("BEST ESTIMATED 1RM — FROM LOGGED TOP SETS")}
            </h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {bests.map((best) => {
                const delta = best.onFile === null ? null : best.e1rm - best.onFile;
                return (
                  <div
                    key={best.lift}
                    className={`rounded-xl border bg-surface px-4 py-3 ${
                      best.pr && prHighlight ? "border-[color:var(--ok)]/60" : "border-border"
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] tracking-[0.16em] text-muted-2">
                        {t(best.label).toUpperCase()}
                      </span>
                      {best.pr && prHighlight && (
                        <span className="rounded bg-[color:var(--ok)]/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[color:var(--ok)]">
                          {t("PR")}
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-muted-2">{t("week {n}", { n: best.week })}</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-[22px] font-semibold">
                        {best.e1rm} {unit}
                      </span>
                      {delta !== null && delta !== 0 && (
                        <span
                          className={`text-[12px] ${delta > 0 ? "text-[color:var(--ok)]" : "text-muted-2"}`}
                        >
                          {delta > 0 ? "+" : ""}
                          {Math.round(delta * 10) / 10} {t("vs on file")}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-2">
                      {best.exercise} · {best.weight} {unit} × {best.reps}
                      {best.rpe !== null && ` @ RPE ${best.rpe}`}
                    </div>

                    {best.onFile !== best.e1rm && (
                      <button
                        type="button"
                        onClick={() =>
                          startTransition(() => {
                            void updateAthlete(athlete.id, maxPatch(best.lift, best.e1rm));
                          })
                        }
                        title={t("Updates the athlete's record. This program keeps the maxes it was written against.")}
                        className="mt-2 rounded border border-border px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
                      >
                        {t("Use as the {lift} 1RM", { lift: t(best.label) })}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-7">
          <BodyweightPanel
            athleteId={athlete.id}
            unit={unit}
            today={today}
            entries={bodyweight}
            meet={meet}
          />
        </div>
      </div>
    </main>
  );
}

/**
 * What the athlete logged in the athlete app, one line per set under the row: weight,
 * reps and effort as they entered it — an RIR stays an RIR.
 */
function SetLines({ logs, sets, unit }: { logs: NonNullable<RowData["logs"]>; sets: number | null; unit: string }) {
  const done = logs.filter((l) => l.done);
  const last = logs.reduce((a, l) => (l.loggedAt > a ? l.loggedAt : a), "");
  return (
    <div className="pb-2 pl-3" style={{ gridColumn: "1 / -1" }}>
      <div className="flex items-baseline gap-2 text-[10px] tracking-[0.12em] text-muted-2">
        <span>
          {t("ATHLETE")} {done.length}/{Math.max(1, sets ?? 1)}
        </span>
        {last && (
          <span className="tracking-normal">
            {new Date(last).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <div className="mt-1 grid w-fit grid-cols-[auto_auto_auto_auto_auto_auto] gap-x-4 gap-y-0.5 text-[11px] tabular-nums">
        {logs.map((l) => (
          <Fragment key={l.setIndex}>
            <span className="text-muted-2">{t("Set {n}", { n: l.setIndex + 1 })}</span>
            <span className={l.done ? "text-foreground" : "text-muted-2"}>{l.weight === null ? "—" : `${l.weight} ${unit}`}</span>
            <span className={l.done ? "text-foreground" : "text-muted-2"}>{l.reps === null ? "—" : `× ${l.reps}`}</span>
            <span className="text-muted">{formatEffort(l) || "—"}</span>
            <span className={l.done ? "text-[color:var(--ok)]" : "text-muted-2"}>{l.done ? "✓" : t("not done")}</span>
            <span className="flex items-center gap-0.5 font-semibold text-pr">{l.pr && <><Trophy size={10} /> {t("PR")}</>}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Writes the estimate back onto the 1RM every target weight is calculated from. */
function maxPatch(lift: "squat" | "bench" | "dead", value: number) {
  if (lift === "squat") return { squat1RM: value };
  if (lift === "bench") return { bench1RM: value };
  return { dead1RM: value };
}

/** A day's check-in answers, in the day's header: the readiness score, then each answer. */
function CheckinNote({ questions, answers }: { questions: CheckinQuestionData[]; answers: CheckinAnswerData[] }) {
  const daily = answers.filter((a) => questions.find((q) => q.id === a.questionId)?.cadence !== "WEEKLY");
  if (daily.length === 0) return null;
  const { score } = readinessOf(questions, daily);
  const low = score !== null && score <= LOW_READINESS;
  return (
    <span className="ml-auto flex min-w-0 items-center gap-2 text-[11px]">
      {score !== null && (
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${low ? "bg-warn/15 text-warn" : "bg-surface-3 text-muted"}`}>
          {t("Readiness {n}/5", { n: score })}
        </span>
      )}
      <Answers questions={questions} answers={daily} />
    </span>
  );
}

/** Each answer as its question's icon, label and value; text answers last, in quotes. */
function Answers({ questions, answers }: { questions: CheckinQuestionData[]; answers: CheckinAnswerData[] }) {
  const yesNo = { yes: t("Yes"), no: t("No") };
  const shown = questions
    .map((q) => ({ q, a: answers.find((a) => a.questionId === q.id) }))
    .filter((x): x is { q: CheckinQuestionData; a: CheckinAnswerData } => x.a !== undefined);
  return (
    <span className="flex min-w-0 items-center gap-2.5 truncate text-muted-2">
      {shown
        .sort((x, y) => Number(x.q.kind === "TEXT") - Number(y.q.kind === "TEXT"))
        .map(({ q, a }) =>
          q.kind === "TEXT" ? (
            <span key={q.id} title={q.label} className="truncate italic text-muted">
              “{a.value}”
            </span>
          ) : (
            <span key={q.id} className="flex shrink-0 items-center gap-1" title={q.label}>
              <CheckinIcon name={q.icon} size={11} className="shrink-0 opacity-70" />
              {q.label} <span className="text-foreground">{formatAnswer(q, a.value, yesNo)}</span>
            </span>
          ),
        )}
    </span>
  );
}

/**
 * Check-in answers with no session header to sit in, above the days: the week's weekly
 * questions, and daily ones answered on a day without a session shown.
 */
function WeekCheckins({
  questions,
  answersByDay,
  dates,
  sessionDates,
}: {
  questions: CheckinQuestionData[];
  answersByDay: Map<string, CheckinAnswerData[]>;
  dates: string[];
  sessionDates: Set<string>;
}) {
  const weekly = new Set(questions.filter((q) => q.cadence === "WEEKLY").map((q) => q.id));
  const weeklyAnswers = dates.flatMap((d) => answersByDay.get(d) ?? []).filter((a) => weekly.has(a.questionId));
  const offDays = dates
    .filter((d) => !sessionDates.has(d))
    .map((d) => ({ day: d, answers: (answersByDay.get(d) ?? []).filter((a) => !weekly.has(a.questionId)) }))
    .filter((d) => d.answers.length > 0);
  if (weeklyAnswers.length === 0 && offDays.length === 0) return null;
  return (
    <div className="mt-2 divide-y divide-border/60 rounded-xl border border-border bg-surface text-[11px]">
      {weeklyAnswers.length > 0 && (
        <div className="flex min-w-0 items-center gap-2 px-4 py-2">
          <span className="w-[120px] shrink-0 tracking-[0.12em] text-muted-2">{t("WEEKLY CHECK-IN")}</span>
          <Answers questions={questions} answers={weeklyAnswers} />
        </div>
      )}
      {offDays.map(({ day, answers }) => {
        const { score } = readinessOf(questions, answers);
        return (
          <div key={day} className="flex min-w-0 items-center gap-2 px-4 py-2">
            <span className="w-[120px] shrink-0 tracking-[0.12em] text-muted-2">
              {t("CHECK-IN")} · {t(WEEKDAYS[weekdayOf(`${day}T00:00:00Z`)])}
            </span>
            {score !== null && (
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${score <= LOW_READINESS ? "bg-warn/15 text-warn" : "bg-surface-3 text-muted"}`}>
                {t("Readiness {n}/5", { n: score })}
              </span>
            )}
            <Answers questions={questions} answers={answers} />
          </div>
        );
      })}
    </div>
  );
}

/** Why a row is off plan, in a few words under the exercise. */
function OffPlanNote({ off, row, target }: { off: OffPlan; row: RowData; target: number | null }) {
  const parts = off.reasons.map((reason) => {
    if (reason === "missed") return t("missed");
    if (reason === "under" && target !== null && row.actualWeight !== null) {
      return t("{n}% under target", { n: Math.round((1 - row.actualWeight / target) * 100) });
    }
    const delta = rpeDelta(row);
    return delta === null ? "" : t("RPE +{n} over plan", { n: Math.round(delta * 10) / 10 });
  });
  return (
    <span className={`block text-[10px] ${off.level === "miss" ? "text-miss" : "text-warn"}`}>
      {parts.filter(Boolean).join(" · ")}
    </span>
  );
}

/** Previous or next athlete on the roster, same screen. */
function AthleteStep({ to, dir }: { to: { id: string; name: string } | null; dir: "left" | "right" }) {
  const icon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
  if (!to) return <span className="grid size-6 place-items-center text-muted-2 opacity-30">{icon}</span>;
  const label = dir === "left" ? t("Previous athlete: {name}", { name: to.name }) : t("Next athlete: {name}", { name: to.name });
  return (
    <Link
      href={`/tracking?athlete=${to.id}`}
      title={label}
      aria-label={label}
      className="grid size-6 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-accent"
    >
      {icon}
    </Link>
  );
}

/** The weeks of the phase as tabs, each with how much of it is done. */
function WeekTabs({
  stats,
  active,
  onSelect,
}: {
  stats: ReturnType<typeof weekStats>;
  active: number;
  onSelect: (week: number) => void;
}) {
  return (
    <div role="tablist" className="mt-5 flex gap-1 overflow-x-auto border-b border-border">
      {stats.map((stat) => {
        const share = stat.setsPrescribed === 0 ? 0 : stat.setsDone / stat.setsPrescribed;
        const on = stat.week === active;
        return (
          <button
            key={stat.week}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(stat.week)}
            title={t("{done}/{of} sets done", { done: stat.setsDone, of: stat.setsPrescribed })}
            className={`-mb-px w-[92px] shrink-0 border-b-2 px-2 pb-2 pt-1 text-left ${
              on ? "border-accent" : "border-transparent hover:border-border"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className={`text-[12px] ${on ? "font-medium text-foreground" : "text-muted"}`}>
                {t("Week {n}", { n: stat.week })}
              </span>
              <span className="text-[10px] tabular-nums text-muted-2">
                {stat.setsPrescribed === 0 ? "—" : `${Math.round(share * 100)}%`}
              </span>
            </div>
            <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-surface-3">
              <div
                className={share >= 1 ? "h-full bg-ok" : "h-full bg-accent"}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
