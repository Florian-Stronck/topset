"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useCommands, type Command } from "@/lib/commands";
import type { AttemptResult, MeetLift } from "@prisma/client";
import {
  applyResultsAsMaxes,
  createMeet,
  deleteMeet,
  planFromMaxes,
  updateAttempt,
  updateMeet,
} from "@/app/competition/actions";
import { BodyweightPanel } from "@/components/BodyweightPanel";
import { useSettings } from "@/components/SettingsProvider";
import { formKeys, NumberInput, TextInput } from "@/components/cells";
import type { BodyweightEntry } from "@/lib/bodyweight";
import {
  best,
  countdown,
  currentAttempt,
  daysUntil,
  LIFT_LABEL,
  MEET_LIFTS,
  totalLifts,
  maxFor,
  meetScore,
  projectedTotal,
  scoreName,
  suggestion,
  total,
  type AttemptData,
  type MeetData,
} from "@/lib/competition";
import { formatDate } from "@/lib/dates";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import type { AthleteData } from "@/lib/types";
import { t } from "@/lib/i18n";

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

type Limit = { limit: number | null; day: string };

export function MeetPlanner({
  athlete,
  meets,
  activeMeetId,
  today,
  calendarDay,
  bodyweights,
  limits,
  readOnly = false,
}: {
  athlete: AthleteData;
  meets: MeetData[];
  activeMeetId: string | null;
  today: string;
  /** Today on the athlete's calendar, yyyy-mm-dd. */
  calendarDay: string;
  bodyweights: BodyweightEntry[];
  limits: Record<string, Limit>;
  /** Shared with this coach to view or review: meets switch, nothing changes. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const { settings, update } = useSettings();
  const scoring = settings.meetScore;

  const now = new Date(today);
  const { upcoming, past, meet } = useMemo(() => {
    const day = new Date(today);
    const upcoming = meets.filter((m) => daysUntil(m.date, day) >= 0);
    const past = meets.filter((m) => daysUntil(m.date, day) < 0).toReversed();
    // With nothing picked, the next meet — or the latest one if they are all behind.
    const meet = meets.find((m) => m.id === activeMeetId) ?? upcoming[0] ?? past[0] ?? null;
    return { upcoming, past, meet };
  }, [meets, activeMeetId, today]);
  const current = meet ? currentAttempt(meet.attempts) : null;
  const open = (id: string) => router.push(`/competition?athlete=${athlete.id}&meet=${id}`);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "meet-new",
        group: "Competition",
        title: t("New meet…"),
        keywords: "add competition create",
        run: () => {
          setCreating(true);
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
      },
      {
        id: "meet-score",
        group: "Competition",
        title: t("Score meets by DOTS / GL"),
        keywords: "points coefficient ipf wilks",
        run: () => update({ meetScore: scoring === "gl" ? "dots" : "gl" }),
      },
      ...meets
        .filter((m) => m.id !== meet?.id)
        .map((m): Command => ({
          id: `open-meet-${m.id}`,
          group: "Competition",
          title: t("Open meet {name}", { name: m.name }),
          kind: "place",
          run: () => router.push(`/competition?athlete=${athlete.id}&meet=${m.id}`),
        })),
    ];
    if (meet) {
      list.push(
        {
          id: "meet-rename",
          group: "Competition",
          title: t("Rename meet"),
          run: () => {
            const input = document.querySelector<HTMLInputElement>('[data-focus="meet-name"] input');
            input?.focus();
            input?.select();
          },
        },
        {
          id: "meet-plan",
          group: "Competition",
          title: t("Plan attempts from 1RMs"),
          keywords: "openers fill attempts",
          run: () =>
            startTransition(() => {
              void planFromMaxes(meet.id);
            }),
        },
      );
      const current = currentAttempt(meet.attempts);
      if (current) {
        const call = (result: AttemptResult) => () =>
          startTransition(() => {
            void updateAttempt(meet.id, current.lift, current.number, { result });
          });
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
          run: () =>
            startTransition(() => {
              void applyResultsAsMaxes(meet.id);
            }),
        });
      }
    }
    return list;
  }, [athlete.id, meet, meets, router, scoring, update]);
  useCommands("competition", commands);

  const unit = athlete.unit === "LB" ? "lb" : "kg";

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div style={{ maxWidth: SHELL_MAX_WIDTH }} className="mx-auto w-full px-6 py-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{t("Competition")}</h1>
            <p className="mt-1 text-[12px] text-muted">
              {athlete.name} · {t("attempts planned off the 1RMs, results written back onto them")}
            </p>
          </div>
          {!readOnly && (
            <button
              data-tour="new-meet"
              type="button"
              onClick={() => setCreating((c) => !c)}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
            >
              {t("+ New meet")}
            </button>
          )}
        </div>
        {readOnly && <p className="mt-2 text-[12px] text-muted">{t("Shared with you to look at: meets can't be changed here.")}</p>}

        {creating && (
          <NewMeetForm
            athleteId={athlete.id}
            onDone={(id) => {
              setCreating(false);
              open(id);
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {meet ? (
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav className="space-y-4">
              <RailGroup label={t("UPCOMING")}>
                {upcoming.map((m) => (
                  <RailItem key={m.id} active={m.id === meet.id} onClick={() => open(m.id)} name={m.name}>
                    <span className={daysUntil(m.date, now) <= 21 ? "text-accent" : ""}>{countdown(m.date, now)}</span>
                  </RailItem>
                ))}
              </RailGroup>
              <RailGroup label={t("PAST")}>
                {past.map((m) => {
                  const sum = total(m.attempts);
                  const score = meetScore(sum, m.bodyweight, athlete.sex, athlete.unit, scoring);
                  return (
                    <RailItem key={m.id} active={m.id === meet.id} onClick={() => open(m.id)} name={m.name}>
                      {formatDate(m.date, true)}
                      {sum !== null && ` · ${sum} ${unit}`}
                      {score !== null && ` · ${score.toFixed(1)} ${scoreName()}`}
                    </RailItem>
                  );
                })}
              </RailGroup>
            </nav>

            <div inert={readOnly} className="min-w-0 space-y-3">
              <MeetHeader
                athlete={athlete}
                meet={meet}
                today={now}
                scoring={scoring}
                onScoring={(meetScore) => update({ meetScore })}
              />
              <AttemptBoard athlete={athlete} meet={meet} current={current} />
              {daysUntil(meet.date, now) >= 0 && (
                <BodyweightPanel
                  athleteId={athlete.id}
                  unit={unit}
                  today={calendarDay}
                  entries={bodyweights}
                  meet={{ name: meet.name, weightClass: meet.weightClass, ...(limits[meet.id] ?? { limit: null, day: meet.date.slice(0, 10) }) }}
                />
              )}
              {/* Delete lives at the bottom so it is never next to the attempt buttons. */}
              <div className="flex justify-end pb-10 pt-4">
                <DeleteMeet
                  meet={meet}
                  onDeleted={() =>
                    startTransition(() => {
                      router.push(`/competition?athlete=${athlete.id}`);
                    })
                  }
                />
              </div>
            </div>
          </div>
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

function RailGroup({ label, children }: { label: string; children: React.ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <div>
      <div className="px-2 text-[10px] tracking-[0.16em] text-muted-2">{label}</div>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

function RailItem({
  active,
  onClick,
  name,
  children,
}: {
  active: boolean;
  onClick: () => void;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg px-2 py-1.5 text-left ${
        active ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2/60 hover:text-foreground"
      }`}
    >
      <div className="truncate text-[13px] font-medium">{name}</div>
      <div className="truncate text-[11px] text-muted-2">{children}</div>
    </button>
  );
}

function MeetHeader({
  athlete,
  meet,
  today,
  scoring,
  onScoring,
}: {
  athlete: AthleteData;
  meet: MeetData;
  today: Date;
  scoring: "dots" | "gl";
  onScoring: (kind: "dots" | "gl") => void;
}) {
  const [, startTransition] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const days = daysUntil(meet.date, today);
  const meetTotal = total(meet.attempts);
  const projected = projectedTotal(meet.attempts);
  const score = meetScore(meetTotal, meet.bodyweight, athlete.sex, athlete.unit, scoring);
  const projectedScore = meetScore(projected, meet.bodyweight, athlete.sex, athlete.unit, scoring);
  const name = scoring === "gl" ? "GL" : "DOTS";

  function patchMeet(patch: Parameters<typeof updateMeet>[1]) {
    startTransition(() => {
      void updateMeet(meet.id, patch);
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-[220px] flex-1">
          <div data-focus="meet-name" className="-ml-2">
            <TextInput
              value={meet.name}
              placeholder={t("Meet name")}
              className="!text-[18px] font-semibold"
              onCommit={(v) => v && patchMeet({ name: v })}
            />
          </div>
          <div className="mt-1 pl-0.5">
            <input
              type="date"
              value={meet.date.slice(0, 10)}
              onChange={(e) => e.target.value && patchMeet({ date: e.target.value })}
              className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted outline-none focus:ring-1 focus:ring-accent/60"
            />
          </div>
        </div>
        <div className={`text-right ${days >= 0 && days <= 21 ? "text-accent" : "text-muted"}`}>
          <div className="text-[22px] font-semibold leading-none">
            {days === 0 ? t("Meet day") : countdown(meet.date, today)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 px-4 pb-4">
        <Field label={t("FEDERATION")}>
          <TextInput value={meet.federation} placeholder={t("e.g. IPF")} onCommit={(v) => patchMeet({ federation: v })} />
        </Field>
        <Field label={t("CLASS")}>
          <TextInput value={meet.weightClass} placeholder={t("e.g. 93 kg")} onCommit={(v) => patchMeet({ weightClass: v })} />
        </Field>
        <Field label={t("BODYWEIGHT ({unit})", { unit })}>
          <NumberInput value={meet.bodyweight} align="left" onCommit={(v) => patchMeet({ bodyweight: v })} />
        </Field>
      </div>

      <div className="grid grid-cols-3 border-t border-border">
        <Stat label={t("TOTAL")} value={meetTotal === null ? "—" : `${meetTotal} ${unit}`} />
        <Stat
          label={
            <span className="inline-flex overflow-hidden rounded border border-border">
              {(["dots", "gl"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={kind === scoring}
                  onClick={() => kind !== scoring && onScoring(kind)}
                  className={`px-1.5 ${kind === scoring ? "bg-surface-2 text-foreground" : "hover:text-foreground"}`}
                >
                  {kind === "gl" ? "GL" : "DOTS"}
                </button>
              ))}
            </span>
          }
          value={score === null ? "—" : score.toFixed(1)}
          note={
            !athlete.sex
              ? t("set the division on the athlete's card")
              : meet.bodyweight === null
                ? t("needs the meet bodyweight")
                : undefined
          }
        />
        <Stat
          label={t("PROJECTED")}
          value={projected === null ? "—" : `${projected} ${unit}`}
          note={projectedScore === null ? t("if every attempt left goes") : `${projectedScore.toFixed(1)} ${name}`}
        />
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: React.ReactNode; value: string; note?: string }) {
  return (
    <div className="border-r border-border px-4 py-3 last:border-r-0">
      <div className="text-[10px] tracking-[0.16em] text-muted-2">{label}</div>
      <div className="mt-0.5 text-[20px] font-semibold">{value}</div>
      {note && <div className="text-[11px] text-muted-2">{note}</div>}
    </div>
  );
}

function AttemptBoard({
  athlete,
  meet,
  current,
}: {
  athlete: AthleteData;
  meet: MeetData;
  current: { lift: MeetLift; number: number } | null;
}) {
  const [, startTransition] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const meetTotal = total(meet.attempts);
  const head = "px-3 py-2 text-left text-[10px] font-normal tracking-[0.16em] text-muted-2";

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t("ATTEMPTS")}</h2>
        <span className="text-[11px] text-muted-2">· {t("G good, M miss on a focused result")}</span>
        <button
          type="button"
          onClick={() =>
            startTransition(() => {
              void planFromMaxes(meet.id);
            })
          }
          title={t("Fill the blank attempts from the athlete's 1RMs")}
          className="ml-auto rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
        >
          {t("Plan from 1RMs")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={head} />
              {[1, 2, 3].map((n) => (
                <th key={n} className={head}>
                  {n}
                </th>
              ))}
              <th className={`${head} text-right`}>{t("BEST")}</th>
            </tr>
          </thead>
          <tbody>
            {MEET_LIFTS.map((lift) => {
              const oneRM = maxFor(lift, athlete);
              const made = best(meet.attempts, lift);
              return (
                <tr key={lift}>
                  <td className="border-t border-border px-3 py-2 align-top">
                    <div className="text-[13px] font-medium">{t(LIFT_LABEL[lift])}</div>
                    <div className="text-[11px] text-muted-2">
                      {oneRM === null ? t("no 1RM on file") : `1RM ${oneRM} ${unit}`}
                    </div>
                  </td>
                  {[1, 2, 3].map((number) => (
                    <td key={number} className="border-t border-border px-1.5 py-2">
                      <AttemptCell
                        meet={meet}
                        lift={lift}
                        number={number}
                        oneRM={oneRM}
                        athlete={athlete}
                        current={current?.lift === lift && current.number === number}
                      />
                    </td>
                  ))}
                  <td className="border-t border-border px-3 py-2 text-right text-[15px] font-semibold">
                    {made === null ? <span className="text-muted-2">—</span> : made}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {meetTotal !== null && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
          <div className="text-[12px] text-muted">
            {totalLifts().map((lift) => `${t(LIFT_LABEL[lift])} ${best(meet.attempts, lift)}`).join(" · ")} {unit}
          </div>
          <button
            type="button"
            onClick={() =>
              startTransition(() => {
                void applyResultsAsMaxes(meet.id);
              })
            }
            className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
          >
            {t("Save results as the new 1RMs")}
          </button>
        </div>
      )}
    </section>
  );
}

function AttemptCell({
  meet,
  lift,
  number,
  oneRM,
  athlete,
  current,
}: {
  meet: MeetData;
  lift: MeetLift;
  number: number;
  oneRM: number | null;
  athlete: AthleteData;
  current: boolean;
}) {
  const [, startTransition] = useTransition();
  const attempt =
    meet.attempts.find((a) => a.lift === lift && a.number === number) ??
    ({ id: `${meet.id}-${lift}-${number}`, lift, number, weight: null, result: "PENDING" } satisfies AttemptData);
  const hint = suggestion(meet.attempts, lift, number, oneRM, athlete.unit);
  const pct = attempt.weight !== null && oneRM ? Math.round((attempt.weight / oneRM) * 100) : null;

  const call = (result: AttemptResult) =>
    startTransition(() => {
      void updateAttempt(meet.id, lift, number, { result });
    });

  return (
    <div
      className={`rounded-lg border bg-surface-2 p-1 ${
        current ? "border-accent/60 ring-2 ring-accent/30" : "border-border"
      }`}
    >
      <NumberInput
        value={attempt.weight}
        align="left"
        placeholder={hint === null ? "—" : String(hint)}
        className="!text-[15px] font-medium"
        onCommit={(v) =>
          startTransition(() => {
            void updateAttempt(meet.id, lift, number, { weight: v });
          })
        }
      />
      <div className="mt-1 flex items-center gap-1.5 px-1">
        <span className={`text-[11px] ${pct !== null && pct > 100 ? "text-[color:var(--ok)]" : "text-muted-2"}`}>
          {pct === null ? "" : `${pct}%`}
        </span>
        <button
          type="button"
          title={t("Pending → good → miss")}
          onClick={() => call(RESULT_CYCLE[attempt.result])}
          onKeyDown={(e) => {
            const result = RESULT_KEYS[e.key];
            if (!result || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            call(result);
          }}
          className={`ml-auto h-7 min-w-[64px] rounded border px-2 text-[11px] tracking-wider ${RESULT_STYLE[attempt.result]}`}
        >
          {RESULT_LABEL[attempt.result]}
        </button>
      </div>
    </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-[140px]">
      <div className="text-[10px] tracking-[0.14em] text-muted-2">{label}</div>
      <div className="mt-0.5 rounded border border-border bg-surface-2">{children}</div>
    </div>
  );
}
