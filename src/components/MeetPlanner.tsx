"use client";

import { useCoachActions } from "@/components/CoachActions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useCommands, type Command } from "@/lib/commands";
import type { AttemptResult } from "@prisma/client";
import type { Road, TrainingFacts } from "@/app/competition/data";
import { AttemptsTab } from "@/components/competition/AttemptsTab";
import { HistoryTab } from "@/components/competition/HistoryTab";
import { RoadTab } from "@/components/competition/RoadTab";
import { useSettings } from "@/components/SettingsProvider";
import { formKeys, TextInput } from "@/components/cells";
import { bodyweightSummary, dailyWeights, projectWeight, type BodyweightEntry } from "@/lib/bodyweight";
import {
  COMPETITION_TABS,
  countdown,
  currentAttempt,
  daysUntil,
  meetScore,
  scoreName,
  THIRD_PLANS,
  total,
  type CompetitionTab,
  type MeetData,
  type Rack,
  type ThirdPlan,
} from "@/lib/competition";
import { formatDate, weekdayOf } from "@/lib/dates";
import { REMINDER_KINDS, type ReminderKind } from "@/lib/meet-reminders";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import type { AthleteData } from "@/lib/types";
import { t, weekdayShort } from "@/lib/i18n";

type Limit = { limit: number | null; day: string };

const TAB_LABEL: Record<CompetitionTab, string> = {
  attempts: "Attempts",
  road: "Road to the meet",
  history: "History",
};

/** The palette's name for each reminder, as on the Road tab. */
export const REMINDER_LABEL: Record<ReminderKind, string> = {
  list: "14 days out: what's left on their list",
  week: "7 days out",
  eve: "The day before: weigh-in",
  morning: "Meet morning",
  results: "The day after: the result",
};

const PLAN_LABEL: Record<ThirdPlan, string> = {
  safe: "Plan every third safe",
  planned: "Plan every third off the 1RMs",
  push: "Plan every third pushed",
};

export function MeetPlanner({
  athlete,
  meets,
  meet,
  tab,
  training,
  road,
  today,
  calendarDay,
  bodyweights,
  linked,
  racks,
  limits,
  readOnly = false,
}: {
  athlete: AthleteData;
  meets: MeetData[];
  /** The meet on show: the one picked, else the next, else the latest. */
  meet: MeetData | null;
  tab: CompetitionTab;
  /** What training says, for the Attempts tab. */
  training: TrainingFacts | null;
  /** The program leading to the meet, for the Road tab. */
  road: Road | null;
  today: string;
  /** Today on the athlete's calendar, yyyy-mm-dd. */
  calendarDay: string;
  bodyweights: BodyweightEntry[];
  /** Whether the athlete has a link to the athlete app. */
  linked: boolean;
  /** The athlete's rack heights, per brand of rack. */
  racks: Record<string, Rack>;
  limits: Record<string, Limit>;
  /** Shared with this coach to view or review: meets switch, nothing changes. */
  readOnly?: boolean;
}) {
  const { addUsualTasks, applyResultsAsMaxes, planFromMaxes, setReminder, setThirds, updateAttempt, updateMeet, meetHref } = useCoachActions();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const { settings, update } = useSettings();
  const scoring = settings.meetScore;

  const now = new Date(today);
  const { upcoming, past } = useMemo(() => {
    const day = new Date(today);
    return {
      upcoming: meets.filter((m) => daysUntil(m.date, day) >= 0),
      past: meets.filter((m) => daysUntil(m.date, day) < 0).toReversed(),
    };
  }, [meets, today]);
  const open = (id: string, to: CompetitionTab = tab) => router.push(meetHref(athlete.id, id, to));
  const newMeet = () => {
    setCreating(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const weight = useMemo(() => {
    const daily = dailyWeights(bodyweights);
    const summary = bodyweightSummary(daily, calendarDay);
    const limit = meet ? (limits[meet.id] ?? null) : null;
    return {
      current: summary.avg7 ?? summary.latest?.weight ?? null,
      limit: limit?.limit ?? null,
      projected: limit ? (projectWeight(daily, calendarDay, limit.day)?.weight ?? null) : null,
    };
  }, [bodyweights, calendarDay, limits, meet]);

  const commands = useMemo<Command[]>(() => {
    const run = (action: () => Promise<unknown>) => () =>
      startTransition(() => {
        void action();
      });
    const list: Command[] = [
      {
        id: "meet-new",
        group: "Competition",
        title: t("New meet…"),
        keywords: "add competition create past",
        run: newMeet,
      },
      {
        id: "meet-score",
        group: "Competition",
        title: t("Score meets by DOTS / GL"),
        keywords: "points coefficient ipf wilks",
        run: () => update({ meetScore: scoring === "gl" ? "dots" : "gl" }),
      },
      ...COMPETITION_TABS.map(
        (v): Command => ({
          id: `competition-tab-${v}`,
          group: "Competition",
          title: t(TAB_LABEL[v]),
          keywords: "competition tab attempts road timeline checklist history meets",
          kind: "place",
          run: () => router.push(meetHref(athlete.id, meet?.id ?? null, v)),
        }),
      ),
      ...meets
        .filter((m) => m.id !== meet?.id)
        .map((m): Command => ({
          id: `open-meet-${m.id}`,
          group: "Competition",
          title: t("Open meet {name}", { name: m.name }),
          kind: "place",
          run: () => router.push(meetHref(athlete.id, m.id, tab)),
        })),
    ];
    if (meet && !readOnly) {
      const focus = (selector: string, to: CompetitionTab) => () => {
        const go = () => {
          const input = document.querySelector<HTMLInputElement>(selector);
          input?.focus();
          input?.select();
        };
        if (tab === to) go();
        else {
          router.push(meetHref(athlete.id, meet.id, to));
          setTimeout(go, 400);
        }
      };
      list.push(
        {
          id: "meet-rename",
          group: "Competition",
          title: t("Rename meet"),
          run: focus('[data-focus="meet-name"] input', tab),
        },
        {
          id: "meet-goal",
          group: "Competition",
          title: t("Set the goal total"),
          keywords: "target aim",
          run: focus('[data-focus="meet-goal"] input', "attempts"),
        },
        {
          id: "meet-plan",
          group: "Competition",
          title: t("Plan attempts from 1RMs"),
          keywords: "openers fill attempts",
          run: run(() => planFromMaxes(meet.id)),
        },
        ...THIRD_PLANS.map(
          (plan): Command => ({
            id: `meet-thirds-${plan}`,
            group: "Competition",
            title: t(PLAN_LABEL[plan]),
            keywords: "third attempt safe push jump",
            run: run(() => setThirds(meet.id, plan)),
          }),
        ),
      );
      if (meet.tasks.length === 0) {
        list.push({
          id: "meet-checklist",
          group: "Competition",
          title: t("Add the usual checklist"),
          keywords: "todo kit entry hotel",
          run: run(() => addUsualTasks(meet.id)),
        });
      }
      list.push(
        {
          id: "meet-share",
          group: "Competition",
          title: t("Show this meet in the athlete app: on / off"),
          keywords: "phone share athlete app",
          run: run(() => updateMeet(meet.id, { shared: !meet.shared })),
        },
        {
          id: "meet-share-attempts",
          group: "Competition",
          title: t("Show the attempts in the athlete app: on / off"),
          keywords: "phone share openers plan",
          run: run(() => updateMeet(meet.id, { shareAttempts: !meet.shareAttempts })),
        },
        ...REMINDER_KINDS.map(
          (kind): Command => ({
            id: `meet-reminder-${kind}`,
            group: "Competition",
            title: t("Reminder, {when}: on / off", { when: t(REMINDER_LABEL[kind]) }),
            keywords: "push notification nudge phone",
            run: run(() => setReminder(meet.id, kind, { on: !meet.reminders.on[kind] })),
          }),
        ),
      );
      const current = currentAttempt(meet.attempts);
      if (current) {
        const call = (result: AttemptResult) => run(() => updateAttempt(meet.id, current.lift, current.number, { result }));
        list.push(
          {
            id: "meet-good",
            group: "Competition",
            title: t("Mark the current attempt good"),
            keywords: "white lights made",
            run: call("GOOD"),
          },
          {
            id: "meet-miss",
            group: "Competition",
            title: t("Mark the current attempt missed"),
            keywords: "red lights no lift",
            run: call("MISS"),
          },
        );
      }
      if (total(meet.attempts) !== null) {
        list.push({
          id: "meet-results",
          group: "Competition",
          title: t("Save results as the new 1RMs"),
          keywords: "maxes write back",
          run: run(() => applyResultsAsMaxes(meet.id)),
        });
      }
    }
    return list;
  }, [athlete.id, meet, meets, readOnly, router, scoring, tab, update, addUsualTasks, applyResultsAsMaxes, meetHref, planFromMaxes, setReminder, setThirds, updateAttempt, updateMeet]);
  useCommands("competition", commands);

  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const onScoring = (meetScore: "dots" | "gl") => update({ meetScore });

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div style={{ maxWidth: SHELL_MAX_WIDTH }} className="mx-auto w-full px-6 py-7">
        <nav aria-label={t("Meets")} className="flex flex-wrap items-stretch gap-2">
          {[...upcoming, ...past].map((m) => {
            const on = m.id === meet?.id;
            const days = daysUntil(m.date, now);
            const sum = total(m.attempts);
            const score = meetScore(sum, m.bodyweight, athlete.sex, athlete.unit, scoring);
            return (
              <Link
                key={m.id}
                href={meetHref(athlete.id, m.id, tab)}
                aria-current={on ? "page" : undefined}
                className={`flex min-w-0 max-w-[260px] flex-col rounded-lg border px-3 py-1.5 ${
                  on ? "border-accent/50 bg-accent-soft" : "border-border bg-surface hover:border-muted-2"
                }`}
              >
                <span className="truncate text-[12.5px] font-medium">{m.name}</span>
                <span className={`truncate text-[11px] ${days >= 0 && days <= 21 ? "text-accent" : "text-muted-2"}`}>
                  {days >= 0
                    ? `${formatDate(m.date)} · ${countdown(m.date, now)}`
                    : [formatDate(m.date, true), sum !== null && `${sum} ${unit}`, score !== null && `${score.toFixed(1)} ${scoreName()}`]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
              </Link>
            );
          })}
          {!readOnly && (
            <button
              data-tour="new-meet"
              type="button"
              onClick={() => setCreating((c) => !c)}
              className="rounded-lg border border-dashed border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
            >
              {t("+ New meet")}
            </button>
          )}
        </nav>
        {readOnly && <p className="mt-2 text-[12px] text-muted">{t("Shared with you to look at: meets can't be changed here.")}</p>}

        {creating && (
          <NewMeetForm
            athleteId={athlete.id}
            onDone={(id) => {
              setCreating(false);
              open(id, tab === "history" ? "history" : "attempts");
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {meet ? (
          <>
            <MeetHeader athlete={athlete} meet={meet} today={now} readOnly={readOnly} />
            <nav role="tablist" aria-label={t("Meet")} className="mt-4 flex gap-1 border-b border-border">
              {COMPETITION_TABS.map((v) => {
                const on = v === tab;
                return (
                  <Link
                    key={v}
                    role="tab"
                    aria-selected={on}
                    href={meetHref(athlete.id, meet.id, v)}
                    scroll={false}
                    className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-[13px] ${
                      on ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"
                    }`}
                  >
                    {t(TAB_LABEL[v])}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 space-y-4">
              {tab === "attempts" && (
                <div inert={readOnly} className="space-y-4">
                  <AttemptsTab athlete={athlete} meet={meet} meets={meets} training={training} weight={weight} today={now} scoring={scoring} onScoring={onScoring} />
                </div>
              )}
              {tab === "road" && (
                <div inert={readOnly} className="space-y-4">
                  <RoadTab athlete={athlete} meet={meet} road={road} today={now} calendarDay={calendarDay} bodyweights={bodyweights} limit={limits[meet.id] ?? null} linked={linked} racks={racks} />
                </div>
              )}
              {tab === "history" && (
                <HistoryTab athlete={athlete} meets={meets} picked={meet.id} today={now} scoring={scoring} onScoring={onScoring} onNew={readOnly ? null : newMeet} />
              )}
              {tab !== "history" && !readOnly && (
                // Delete lives at the bottom so it is never next to the attempt buttons.
                <div className="flex justify-end pb-10 pt-2">
                  <DeleteMeet
                    meet={meet}
                    onDeleted={() =>
                      startTransition(() => {
                        router.push(meetHref(athlete.id, null, tab));
                      })
                    }
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          !creating && (
            <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <div className="text-[13px] text-muted">{t("No meet on the calendar for {name}.", { name: athlete.name })}</div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
                >
                  {t("Add one")}
                </button>
              )}
            </div>
          )
        )}
      </div>
    </main>
  );
}

/** Which meet, where and when, and how long until it — on every tab. */
function MeetHeader({ athlete, meet, today, readOnly }: { athlete: AthleteData; meet: MeetData; today: Date; readOnly: boolean }) {
  const { updateMeet, meetHref } = useCoachActions();
  const [, startTransition] = useTransition();
  const days = daysUntil(meet.date, today);
  const ymd = meet.date.slice(0, 10);
  const facts = [
    meet.federation,
    `${weekdayShort(weekdayOf(ymd))} ${formatDate(ymd, true)}`,
    meet.weighInTime && t("weigh-in {when}", { when: `${weekdayShort(weekdayOf(meet.weighInDay ?? ymd))} ${meet.weighInTime}` }),
    meet.session,
    meet.venue,
  ].filter(Boolean);

  return (
    <header className="mt-5 flex flex-wrap items-end gap-4">
      <div className="min-w-[260px] flex-1">
        <div className="text-[12px] text-muted">
          {athlete.name}
          {meet.weightClass && ` · ${meet.weightClass}`}
        </div>
        <div data-focus="meet-name" inert={readOnly} className="-ml-2 mt-0.5">
          <TextInput
            value={meet.name}
            placeholder={t("Meet name")}
            className="!text-[22px] font-semibold"
            onCommit={(v) =>
              v &&
              startTransition(() => {
                void updateMeet(meet.id, { name: v });
              })
            }
          />
        </div>
        <p className="mt-1 text-[12px] text-muted">
          {facts.join(" · ")}
          {!readOnly && (
            <>
              {" · "}
              <Link href={meetHref(athlete.id, meet.id, "road")} scroll={false} className="text-muted-2 underline-offset-2 hover:text-accent hover:underline">
                {t("Edit details")}
              </Link>
            </>
          )}
        </p>
      </div>
      <div className={`flex items-baseline gap-2 ${days >= 0 && days <= 21 ? "text-accent" : "text-muted"}`}>
        {days > 0 ? (
          <>
            <span className="text-[36px] font-semibold leading-none tabular-nums">{days}</span>
            <span className="text-[13px]">{t(days === 1 ? "day out" : "days out")}</span>
          </>
        ) : (
          <span className="text-[20px] font-semibold">{days === 0 ? t("Meet day") : countdown(meet.date, today)}</span>
        )}
      </div>
    </header>
  );
}

function NewMeetForm({
  athleteId,
  onDone,
  onCancel,
}: {
  athleteId: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { createMeet } = useCoachActions();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    name: "",
    date: new Date().toISOString().slice(0, 10),
    federation: "",
    weightClass: "",
  });

  const field =
    "w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";

  async function create() {
    setPending(true);
    const id = await createMeet({ athleteId, ...form });
    setPending(false);
    onDone(id);
  }

  return (
    <div
      onKeyDown={formKeys(create, onCancel, pending)}
      className="mt-4 rounded-xl border border-border bg-surface-2 p-3"
    >
      <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("NEW MEET")}</div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-4">
        <input
          autoFocus
          value={form.name}
          placeholder={t("Meet name")}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={field}
        />
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className={field}
        />
        <input
          value={form.federation}
          placeholder={t("Federation")}
          onChange={(e) => setForm({ ...form, federation: e.target.value })}
          className={field}
        />
        <input
          value={form.weightClass}
          placeholder={t("Weight class")}
          onChange={(e) => setForm({ ...form, weightClass: e.target.value })}
          className={field}
        />
      </div>
      <div className="mt-2.5 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground"
        >
          {t("Cancel")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={create}
          className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
        >
          {pending ? t("Creating…") : t("Create")}
        </button>
      </div>
    </div>
  );
}

function DeleteMeet({ meet, onDeleted }: { meet: MeetData; onDeleted: () => void }) {
  const { deleteMeet } = useCoachActions();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[11px] text-muted-2 hover:text-accent"
      >
        {t("Delete meet")}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-accent/50 bg-surface px-3 py-1.5">
      <span className="text-[11px] text-muted">{t("Delete “{name}” and its attempts?", { name: meet.name })}</span>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          await deleteMeet(meet.id);
          onDeleted();
        }}
        className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-60"
      >
        {pending ? t("Deleting…") : t("Delete")}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[11px] text-muted-2 hover:text-foreground"
      >
        {t("Cancel")}
      </button>
    </div>
  );
}
