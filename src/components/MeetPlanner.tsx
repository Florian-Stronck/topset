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
import { formKeys, NumberInput, TextInput } from "@/components/cells";
import {
  best,
  countdown,
  daysUntil,
  LIFT_LABEL,
  MEET_LIFTS,
  totalLifts,
  maxFor,
  suggestion,
  total,
  type AttemptData,
  type MeetData,
} from "@/lib/competition";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import type { AthleteData } from "@/lib/types";
import { t } from "@/lib/i18n";

const RESULT_CYCLE: Record<AttemptResult, AttemptResult> = {
  PENDING: "GOOD",
  GOOD: "MISS",
  MISS: "PENDING",
};

const RESULT_STYLE: Record<AttemptResult, string> = {
  PENDING: "border-border text-muted-2",
  GOOD: "border-[color:var(--ok)]/50 bg-[color:var(--ok)]/10 text-[color:var(--ok)]",
  MISS: "border-accent/50 bg-accent-soft text-accent",
};

const RESULT_LABEL: Record<AttemptResult, string> = {
  PENDING: "—",
  GOOD: "GOOD",
  MISS: "MISS",
};

export function MeetPlanner({
  athlete,
  meets,
  activeMeetId,
  today,
}: {
  athlete: AthleteData;
  meets: MeetData[];
  activeMeetId: string | null;
  today: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  const now = new Date(today);
  const meet = meets.find((m) => m.id === activeMeetId) ?? meets[0] ?? null;

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
  }, [athlete.id, meet, meets, router]);
  useCommands("competition", commands);

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
          <button
            type="button"
            onClick={() => setCreating((c) => !c)}
            className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
          >
            {t("+ New meet")}
          </button>
        </div>

        {creating && (
          <NewMeetForm
            athleteId={athlete.id}
            onDone={(id) => {
              setCreating(false);
              router.push(`/competition?athlete=${athlete.id}&meet=${id}`);
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {meets.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {meets.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => router.push(`/competition?athlete=${athlete.id}&meet=${m.id}`)}
                className={`rounded-full border px-3 py-1.5 text-[12px] ${
                  m.id === meet?.id
                    ? "border-accent/50 bg-surface-2 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {m.name}
                <span className="ml-2 text-[11px] text-muted-2">{countdown(m.date, now)}</span>
              </button>
            ))}
          </div>
        )}

        {meet ? (
          <MeetCard athlete={athlete} meet={meet} today={now} />
        ) : (
          !creating && (
            <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <div className="text-[13px] text-muted">No meet on the calendar for {athlete.name}.</div>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
              >
                {t("Add one")}
              </button>
            </div>
          )
        )}
      </div>

      {/* Delete lives at the bottom so it is never next to the attempt buttons. */}
      {meet && (
        <div
          style={{ maxWidth: SHELL_MAX_WIDTH }}
          className="mx-auto flex w-full justify-end px-6 pb-10"
        >
          <DeleteMeet
            meet={meet}
            onDeleted={() =>
              startTransition(() => {
                router.push(`/competition?athlete=${athlete.id}`);
              })
            }
          />
        </div>
      )}
    </main>
  );
}

function MeetCard({
  athlete,
  meet,
  today,
}: {
  athlete: AthleteData;
  meet: MeetData;
  today: Date;
}) {
  const [, startTransition] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const days = daysUntil(meet.date, today);
  const meetTotal = total(meet.attempts);

  function patchMeet(patch: Parameters<typeof updateMeet>[1]) {
    startTransition(() => {
      void updateMeet(meet.id, patch);
    });
  }

  return (
    <section className="mt-5">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[220px] flex-1">
            <div data-focus="meet-name" className="-ml-2">
              <TextInput
                value={meet.name}
                placeholder={t("Meet name")}
                className="!text-[16px] font-semibold"
                onCommit={(v) => v && patchMeet({ name: v })}
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 pl-0.5 text-[11px] text-muted-2">
              <input
                type="date"
                value={meet.date.slice(0, 10)}
                onChange={(e) => e.target.value && patchMeet({ date: e.target.value })}
                className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-accent/60"
              />
              <span className={days >= 0 && days <= 21 ? "text-accent" : ""}>
                {countdown(meet.date, today)}
              </span>
            </div>
          </div>

          <Field label={t("FEDERATION")}>
            <TextInput
              value={meet.federation}
              placeholder={t("e.g. IPF")}
              onCommit={(v) => patchMeet({ federation: v })}
            />
          </Field>
          <Field label={t("CLASS")}>
            <TextInput
              value={meet.weightClass}
              placeholder={t("e.g. 93 kg")}
              onCommit={(v) => patchMeet({ weightClass: v })}
            />
          </Field>
          <Field label={t("BODYWEIGHT ({unit})", { unit })}>
            <NumberInput
              value={meet.bodyweight}
              align="left"
              onCommit={(v) => patchMeet({ bodyweight: v })}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              startTransition(() => {
                void planFromMaxes(meet.id);
              })
            }
            title={t("Fill the blank attempts from the athlete's 1RMs")}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
          >
            {t("Plan from 1RMs")}
          </button>

          <div className="ml-auto flex items-baseline gap-2">
            <span className="text-[11px] tracking-[0.16em] text-muted-2">{t("TOTAL")}</span>
            <span className="text-[20px] font-semibold">
              {meetTotal === null ? "—" : `${meetTotal} ${unit}`}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {MEET_LIFTS.map((lift) => (
          <LiftCard
            key={lift}
            lift={lift}
            meet={meet}
            athlete={athlete}
            oneRM={maxFor(lift, athlete)}
          />
        ))}
      </div>

      {meetTotal !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="text-[12px] text-muted">
            {totalLifts().map((lift) => `${t(LIFT_LABEL[lift])} ${best(meet.attempts, lift)}`).join(" · ")}{" "}
            {unit}
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

function LiftCard({
  lift,
  meet,
  athlete,
  oneRM,
}: {
  lift: MeetLift;
  meet: MeetData;
  athlete: AthleteData;
  oneRM: number | null;
}) {
  const [, startTransition] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const made = best(meet.attempts, lift);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] tracking-[0.16em] text-muted-2">
          {t(LIFT_LABEL[lift]).toUpperCase()}
        </span>
        <span className="ml-auto text-[11px] text-muted-2">
          {oneRM === null ? t("no 1RM on file") : `1RM ${oneRM} ${unit}`}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {[1, 2, 3].map((number) => {
          const attempt =
            meet.attempts.find((a) => a.lift === lift && a.number === number) ??
            ({
              id: `${meet.id}-${lift}-${number}`,
              lift,
              number,
              weight: null,
              result: "PENDING",
            } satisfies AttemptData);

          const hint = suggestion(meet.attempts, lift, number, oneRM, athlete.unit);

          return (
            <div key={number} className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-[11px] text-muted-2">{number}</span>

              <div className="flex-1 rounded border border-border bg-surface-2">
                <NumberInput
                  value={attempt.weight}
                  align="left"
                  placeholder={hint === null ? "—" : String(hint)}
                  onCommit={(v) =>
                    startTransition(() => {
                      void updateAttempt(meet.id, lift, number, { weight: v });
                    })
                  }
                />
              </div>

              <button
                type="button"
                title={t("Pending → good → miss")}
                onClick={() =>
                  startTransition(() => {
                    void updateAttempt(meet.id, lift, number, {
                      result: RESULT_CYCLE[attempt.result],
                    });
                  })
                }
                className={`w-[58px] shrink-0 rounded border px-1.5 py-1 text-[11px] tracking-wider ${RESULT_STYLE[attempt.result]}`}
              >
                {RESULT_LABEL[attempt.result]}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-2 text-[11px] text-muted-2">
        {made === null ? t("nothing good yet") : t("best {weight}", { weight: `${made} ${unit}` })}
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
      <span className="text-[11px] text-muted">Delete “{meet.name}” and its attempts?</span>
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
    <div className="w-[150px]">
      <div className="text-[10px] tracking-[0.14em] text-muted-2">{label}</div>
      <div className="mt-0.5 rounded border border-border bg-surface-2">{children}</div>
    </div>
  );
}
