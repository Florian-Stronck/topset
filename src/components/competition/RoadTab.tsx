"use client";

import { useCoachActions } from "@/components/CoachActions";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { updateMeet } from "@/app/competition/actions";
import type { Road } from "@/app/competition/data";
import { BodyweightPanel } from "@/components/BodyweightPanel";
import { NumberInput, TextInput } from "@/components/cells";
import type { BodyweightEntry } from "@/lib/bodyweight";
import { daysUntil, LIFT_LABEL, MEET_LIFTS, reminderFacts, type MeetData, type Rack, type TaskData, type TaskOwner } from "@/lib/competition";
import { formatDate, formatMoment, weekdayOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { REMINDER_KINDS, reminderDay, reminderText, type ReminderKind, type ReminderText } from "@/lib/meet-reminders";
import { overviewHref } from "@/lib/overview-tabs";
import { daysBetween } from "@/lib/schedule";
import type { AthleteData } from "@/lib/types";

type Patch = Parameters<typeof updateMeet>[1];

const readinessTone = (v: number | null) =>
  v === null ? "bg-border" : v >= 3.5 ? "bg-[color:var(--ok)]" : v >= 2.5 ? "bg-warn" : "bg-miss";

/** When each reminder goes, said the way the Road tab lists them. */
const WHEN: Record<ReminderKind, string> = {
  list: "14 days out",
  week: "7 days out",
  eve: "day before",
  morning: "meet morning",
  results: "day after",
};

/** Why a reminder that is on has nothing to send. */
const SILENT: Partial<Record<ReminderKind, string>> = {
  list: "Nothing to send: the athlete's list is done.",
  results: "Sent once every attempt is called.",
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function RoadTab({
  athlete,
  meet,
  road,
  today,
  calendarDay,
  bodyweights,
  limit,
  linked,
  racks,
}: {
  athlete: AthleteData;
  meet: MeetData;
  road: Road | null;
  today: Date;
  calendarDay: string;
  bodyweights: BodyweightEntry[];
  limit: { limit: number | null; day: string } | null;
  linked: boolean;
  racks: Record<string, Rack>;
}) {
  const { updateMeet } = useCoachActions();
  const [, startTransition] = useTransition();
  const save = (patch: Patch) =>
    startTransition(() => {
      void updateMeet(meet.id, patch);
    });
  const unit = athlete.unit === "LB" ? "lb" : "kg";

  return (
    <>
      <Timeline athleteId={athlete.id} meet={meet} road={road} unit={unit} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1.6_1_480px] space-y-4">
          <PhonePanel athlete={athlete} meet={meet} linked={linked} calendarDay={calendarDay} save={save} />
          {daysUntil(meet.date, today) >= 0 && (
            <BodyweightPanel
              athleteId={athlete.id}
              unit={unit}
              today={calendarDay}
              entries={bodyweights}
              meet={{ name: meet.name, weightClass: meet.weightClass, ...(limit ?? { limit: null, day: meet.date.slice(0, 10) }) }}
            />
          )}
        </div>
        <div className="min-w-0 flex-[1_1_300px] space-y-4">
          <Details athlete={athlete} meet={meet} racks={racks} unit={unit} save={save} />
          <Checklist athlete={athlete} meet={meet} />
        </div>
      </div>
    </>
  );
}

/** The program week by week into the meet: phases, the heaviest of each main lift, readiness. */
function Timeline({ athleteId, meet, road, unit }: { athleteId: string; meet: MeetData; road: Road | null; unit: string }) {
  // Programming lives on the desktop only.
  const { phone } = useCoachActions();
  if (!road) {
    return (
      <section className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted">
        {t("No program runs into this meet yet.")}{" "}
        {!phone && (
          <Link href={`/programming?athlete=${athleteId}`} className="text-accent hover:underline">
            {t("Open programming")}
          </Link>
        )}
      </section>
    );
  }
  const after = road.meetWeek === road.weeks.length;
  const columns = road.weeks.length + (after ? 1 : 0);
  const grid = { gridTemplateColumns: `110px repeat(${columns}, minmax(44px, 1fr))` };
  const meetYmd = meet.date.slice(0, 10);
  const heavy = road.lastHeavy;

  return (
    <section aria-labelledby="h-road" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="h-road" className="text-[13px] font-semibold">{t("Road to {meet}", { meet: meet.name })}</h2>
        <span className="text-[11.5px] text-muted-2">{t("{program} · logged where it was, planned where not yet", { program: road.program })}</span>
        <span className="flex-1" />
        {!phone && (
          <Link href={road.href} className="text-[12px] text-muted hover:text-accent">
            {t("Open in Programming →")}
          </Link>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="space-y-1.5" style={{ minWidth: 110 + columns * 44 }}>
          <div className="grid gap-1 text-center text-[10.5px] text-muted-2" style={grid}>
            <span />
            {road.weeks.map((w, i) => (
              <span key={w.start} className={i === road.todayWeek ? "font-semibold text-accent" : i === road.meetWeek ? "font-semibold text-foreground" : ""}>
                {i === road.meetWeek ? formatDate(meetYmd) : `W${i + 1}`}
              </span>
            ))}
            {after && <span className="font-semibold text-foreground">{formatDate(meetYmd)}</span>}
          </div>

          <div className="grid items-center gap-1" style={grid}>
            <span className="text-[11.5px] text-muted">{t("Phase")}</span>
            {road.phases.map((p, i) => (
              <span
                key={`${p.name}-${p.from}`}
                className="truncate rounded px-2 py-1 text-[11px]"
                style={{ gridColumn: `${p.from + 2} / span ${p.weeks}`, background: `color-mix(in srgb, var(--accent) ${18 + (i * 14) % 42}%, transparent)` }}
                title={p.name}
              >
                {p.name}
              </span>
            ))}
            {after && <span className="rounded bg-accent px-2 py-1 text-center text-[11px] font-semibold text-white">{t("Meet")}</span>}
          </div>

          {MEET_LIFTS.map((lift) => (
            <div key={lift} className="grid items-center gap-1" style={grid}>
              <span className="text-[11.5px] text-muted">{t(LIFT_LABEL[lift])}</span>
              {road.weeks.map((w, i) => {
                const top = w.top[lift];
                return (
                  <span
                    key={w.start}
                    title={top ? `${top.weight} ${unit}${top.pct !== null ? ` · ${top.pct}%` : ""} · ${top.logged ? t("logged") : t("planned")}` : undefined}
                    className={`rounded py-1 text-center text-[11px] tabular-nums ${i === road.todayWeek ? "ring-1 ring-foreground/60" : ""} ${
                      top?.logged ? "text-foreground" : "text-muted"
                    }`}
                    style={{ background: top?.pct ? `color-mix(in srgb, var(--accent) ${Math.max(6, Math.min(60, (top.pct - 60) * 1.5))}%, var(--surface-2))` : "var(--surface-2)" }}
                  >
                    {top ? top.weight : ""}
                  </span>
                );
              })}
              {after && <span />}
            </div>
          ))}

          <div className="grid items-center gap-1" style={grid}>
            <span className="text-[11.5px] text-muted">{t("Readiness")}</span>
            {road.weeks.map((w) => (
              <span key={w.start} className="grid place-items-center" title={w.readiness === null ? undefined : String(w.readiness)}>
                <span className={`h-2.5 w-2.5 rounded-full ${readinessTone(w.readiness)}`} />
              </span>
            ))}
            {after && <span />}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[12px] text-muted">
        {heavy
          ? t("Last heavy day {day}, {n} days out: {lift} {w} {u}", {
              day: `${weekdayShort(weekdayOf(heavy.ymd))} ${formatDate(heavy.ymd)}`,
              n: daysBetween(heavy.ymd, meetYmd),
              lift: t(LIFT_LABEL[heavy.lift]),
              w: heavy.weight,
              u: unit,
            })
          : t("No day at 90% or more before the meet.")}
        <span className="text-muted-2"> · {t("Shading: % of the max on file")}</span>
      </p>
    </section>
  );
}

/** Where and when, and the settings to give the platform crew. */
function Details({
  athlete,
  meet,
  racks,
  unit,
  save,
}: {
  athlete: AthleteData;
  meet: MeetData;
  racks: Record<string, Rack>;
  unit: string;
  save: (patch: Patch) => void;
}) {
  const label = "text-[10px] tracking-[0.14em] text-muted-2";
  const input = "h-[30px] rounded border border-border bg-surface-2 px-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";
  const text = (key: "federation" | "weightClass" | "venue" | "session", name: string, placeholder?: string) => (
    <label className="flex flex-col gap-0.5">
      <span className={label}>{name}</span>
      <span className="rounded border border-border bg-surface-2">
        <TextInput value={meet[key]} placeholder={placeholder} onCommit={(v) => save({ [key]: v?.trim() || null })} />
      </span>
    </label>
  );
  const ymd = meet.date.slice(0, 10);

  return (
    <section aria-labelledby="h-details" className="rounded-xl border border-border bg-surface p-4">
      <h2 id="h-details" className="text-[13px] font-semibold">{t("Meet details")}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-0.5">
          <span className={label}>{t("DATE")}</span>
          <input type="date" value={ymd} onChange={(e) => e.target.value && save({ date: e.target.value })} className={input} />
        </label>
        {text("federation", t("FEDERATION"), t("e.g. IPF"))}
        <label className="flex flex-col gap-0.5">
          <span className={label}>{t("WEIGH-IN DAY")}</span>
          <input
            type="date"
            value={meet.weighInDay ?? ymd}
            onChange={(e) => save({ weighInDay: e.target.value && e.target.value !== ymd ? e.target.value : null })}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>{t("WEIGH-IN TIME")}</span>
          <input type="time" value={meet.weighInTime ?? ""} onChange={(e) => save({ weighInTime: e.target.value || null })} className={input} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>{t("LIFTING FROM")}</span>
          <input type="time" value={meet.startTime ?? ""} onChange={(e) => save({ startTime: e.target.value || null })} className={input} />
        </label>
        {text("session", t("SESSION"), t("e.g. Session 1, flight B"))}
        {text("weightClass", t("CLASS"), t("e.g. 93 kg"))}
        <label className="flex flex-col gap-0.5">
          <span className={label}>{t("WEIGHED IN ({unit})", { unit })}</span>
          <span className="rounded border border-border bg-surface-2">
            <NumberInput value={meet.bodyweight} align="left" onCommit={(bodyweight) => save({ bodyweight })} />
          </span>
        </label>
        <div className="col-span-2">{text("venue", t("VENUE"))}</div>
      </div>
      <RackHeights athlete={athlete} meet={meet} racks={racks} save={save} />
    </section>
  );
}

/** The meet's rack brand, and the athlete's heights on it — kept on their profile for every meet on those racks. */
function RackHeights({ athlete, meet, racks, save }: { athlete: AthleteData; meet: MeetData; racks: Record<string, Rack>; save: (patch: Patch) => void }) {
  const { setRack } = useCoachActions();
  const [, startTransition] = useTransition();
  const brand = meet.rackBrand;
  const name = firstName(athlete.name);
  const height = (key: keyof Rack, label: string) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-2">{label}</span>
      <span className="rounded border border-border bg-surface-2">
        <TextInput
          value={meet.racks[key]}
          onCommit={(v) =>
            brand &&
            startTransition(() => {
              void setRack(athlete.id, brand, { [key]: v });
            })
          }
        />
      </span>
    </label>
  );
  return (
    <div className="mt-4 space-y-1.5">
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] tracking-[0.14em] text-muted-2">{t("RACK BRAND")}</span>
        <span className="rounded border border-border bg-surface-2">
          <TextInput value={brand} placeholder={t("e.g. Eleiko")} suggestions={Object.keys(racks)} onCommit={(v) => save({ rackBrand: v?.trim() || null })} />
        </span>
      </label>
      <fieldset disabled={!brand} className={`grid grid-cols-3 gap-2.5 ${brand ? "" : "opacity-50"}`}>
        <legend className="sr-only">{t("RACK HEIGHTS")}</legend>
        {height("squat", t("Squat"))}
        {height("bench", t("Bench"))}
        {height("safety", t("Safeties"))}
      </fieldset>
      <p className="text-[11px] text-muted-2">
        {brand
          ? t("Kept on {name}'s profile for every meet on {brand} racks.", { name, brand })
          : t("Name the rack brand first: heights are kept per brand on {name}'s profile.", { name })}
      </p>
    </div>
  );
}

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-accent" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/** What the athlete app shows of the meet, and the reminders it sends about it. */
function PhonePanel({
  athlete,
  meet,
  linked,
  calendarDay,
  save,
}: {
  athlete: AthleteData;
  meet: MeetData;
  linked: boolean;
  calendarDay: string;
  save: (patch: Patch) => void;
}) {
  const { setReminder, phone } = useCoachActions();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<ReminderKind | null>(null);
  const name = firstName(athlete.name);
  const facts = reminderFacts(meet, meet.tasks, athlete.unit);
  const remind = (kind: ReminderKind, patch: { on?: boolean; text?: ReminderText | null }) =>
    startTransition(() => {
      void setReminder(meet.id, kind, patch);
    });
  const shares = [
    {
      on: meet.shared,
      title: t("Show this meet in the athlete app"),
      text: t("Countdown, weigh-in, session, venue, rack heights and {name}'s part of the checklist", { name }),
      patch: { shared: !meet.shared },
      disabled: false,
    },
    {
      on: meet.shareAttempts,
      title: t("Show the attempts"),
      text: t("Openers on the meet card, the full plan one tap in"),
      patch: { shareAttempts: !meet.shareAttempts },
      disabled: !meet.shared,
    },
  ];

  return (
    <section aria-labelledby="h-phone" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="h-phone" className="text-[13px] font-semibold">{t("On {name}'s phone", { name })}</h2>
        {!linked && (
          <span className="text-[11.5px] text-warn">
            {t("No link to the athlete app yet.")}{" "}
            {!phone && (
              <Link href={`/athletes?link=${athlete.id}`} className="underline underline-offset-2 hover:text-accent">
                {t("Send one")}
              </Link>
            )}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-1">
        {shares.map((row) => (
          <div key={row.title} className={`flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 ${row.disabled ? "opacity-50" : ""}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">{row.title}</span>
              <span className="block text-[11.5px] text-muted-2">{row.text}</span>
            </span>
            <Switch on={row.on} label={row.title} disabled={row.disabled} onChange={() => save(row.patch)} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[10px] tracking-[0.14em] text-muted-2">{t("REMINDERS")}</h3>
        <span className="text-[11.5px] text-muted-2">
          {meet.shared ? t("sent with the morning run, around 06:00 on the phone's clock") : t("sent once the meet shows in the athlete app")}
        </span>
      </div>
      <ul className={`mt-2 space-y-1.5 ${meet.shared ? "" : "opacity-50"}`}>
        {REMINDER_KINDS.map((kind) => {
          const day = reminderDay(kind, meet.date.slice(0, 10));
          const own = meet.reminders.text[kind];
          const text = own ?? reminderText(kind, facts, t);
          const on = meet.reminders.on[kind];
          const past = day < calendarDay;
          return (
            <li key={kind} className="rounded-lg border border-surface-2 px-3 py-2">
              <div className={`grid grid-cols-[100px_minmax(0,1fr)_auto_auto] items-center gap-3 ${on && !past ? "" : "opacity-60"}`}>
                <span className="flex flex-col">
                  <span className="text-[12px] font-medium">{`${weekdayShort(weekdayOf(day))} ${formatDate(day)}`}</span>
                  <span className="text-[11px] text-muted-2">{past ? t("gone by") : t(WHEN[kind])}</span>
                </span>
                <span className="min-w-0">
                  {text ? (
                    <>
                      <span className="block truncate text-[12.5px] font-medium">{text.title}</span>
                      <span className="block truncate text-[12px] text-muted">{text.body}</span>
                    </>
                  ) : (
                    <span className="block text-[12px] text-muted-2">{t(SILENT[kind] ?? "")}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(editing === kind ? null : kind)}
                  className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-muted hover:text-foreground"
                >
                  {t("Edit")}
                </button>
                <Switch on={on} label={t(WHEN[kind])} onChange={() => remind(kind, { on: !on })} />
              </div>
              {editing === kind && (
                <ReminderEditor
                  initial={text ?? { title: "", body: "" }}
                  custom={Boolean(own)}
                  onSave={(next) => {
                    remind(kind, { text: next });
                    setEditing(null);
                  }}
                  onReset={() => {
                    remind(kind, { text: null });
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-muted-2">
        <span>{t("{name} turns meet reminders on or off on the phone.", { name })}</span>
        <span className="flex-1" />
        <Link href={phone ? `/a/coach/chats?athlete=${athlete.id}` : overviewHref("chat", athlete.id)} className="text-muted hover:text-accent">
          {t("Something else to say? Send a note →")}
        </Link>
      </div>
    </section>
  );
}

function ReminderEditor({
  initial,
  custom,
  onSave,
  onReset,
  onCancel,
}: {
  initial: ReminderText;
  custom: boolean;
  onSave: (text: ReminderText) => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const field = "w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";
  return (
    <div className="mt-2 space-y-1.5 border-t border-border pt-2">
      <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label={t("Title")} className={field} />
      <textarea value={body} maxLength={300} rows={2} onChange={(e) => setBody(e.target.value)} aria-label={t("Text")} className={`${field} resize-none`} />
      <p className="text-[11px] text-muted-2">{t("Once reworded, dates, weights and the list no longer fill in by themselves.")}</p>
      <div className="flex flex-wrap justify-end gap-1.5">
        {custom && (
          <button type="button" onClick={onReset} className="mr-auto text-[11px] text-muted-2 hover:text-accent">
            {t("Back to the usual text")}
          </button>
        )}
        <button type="button" onClick={onCancel} className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground">
          {t("Cancel")}
        </button>
        <button
          type="button"
          disabled={!title.trim()}
          onClick={() => onSave({ title, body })}
          className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

/** What's left to sort before the meet: the athlete's part shows, and ticks, on their phone. */
function Checklist({ athlete, meet }: { athlete: AthleteData; meet: MeetData }) {
  const { addTasks, addUsualTasks, removeTask, tickTask } = useCoachActions();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [owner, setOwner] = useState<TaskOwner>("athlete");
  // Ticks show at once; quick ticks in a row each build on the last, not on the page as it was.
  const [list, setList] = useState(meet.tasks);
  const [synced, setSynced] = useState(meet.tasks);
  if (synced !== meet.tasks) {
    setSynced(meet.tasks);
    setList(meet.tasks);
  }
  const run = (action: () => Promise<unknown>) =>
    startTransition(() => {
      void action();
    });
  const tick = (task: TaskData) => {
    setList((was) => was.map((x) => (x.id === task.id ? { ...x, done: !x.done, doneBy: x.done ? null : "coach" } : x)));
    run(() => tickTask(task.id, !task.done));
  };
  const remove = (task: TaskData) => {
    setList((was) => was.filter((x) => x.id !== task.id));
    run(() => removeTask(task.id));
  };
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    run(() => addTasks(meet.id, [{ text, owner }]));
    setDraft("");
  };
  const name = firstName(athlete.name);

  return (
    <section aria-labelledby="h-check" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 id="h-check" className="text-[13px] font-semibold">{t("Checklist")}</h2>
        {list.length > 0 && <span className="text-[11.5px] text-muted-2">{t("{done} of {n}", { done: list.filter((x) => x.done).length, n: list.length })}</span>}
      </div>
      {list.length === 0 ? (
        <button
          type="button"
          onClick={() => run(() => addUsualTasks(meet.id))}
          className="mt-3 rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
        >
          {t("Add the usual checklist")}
        </button>
      ) : (
        <ul className="mt-2.5 space-y-1">
          {list.map((task) => (
            <li key={task.id} className="group flex items-start gap-2 text-[12.5px] leading-snug">
              <input type="checkbox" checked={task.done} onChange={() => tick(task)} aria-label={task.text} className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]" />
              <span className="min-w-0 flex-1">
                <span className={`block ${task.done ? "text-muted-2 line-through" : ""}`}>{task.text}</span>
                {task.done && task.doneBy === "athlete" && (
                  <span className="block text-[11px] text-[color:var(--ok)]">{t("ticked on the phone · {date}", { date: formatMoment(task.updatedAt) })}</span>
                )}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-px text-[10.5px] ${task.owner === "athlete" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>
                {task.owner === "athlete" ? name : t("You")}
              </span>
              <button
                type="button"
                onClick={() => remove(task)}
                aria-label={t("Remove {item}", { item: task.text })}
                className="rounded px-1 text-muted-2 opacity-0 hover:text-miss focus:opacity-100 group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={t("Add an item…")}
          aria-label={t("Add an item")}
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-2 text-[12px] outline-none placeholder:text-muted-2 focus:border-accent"
        />
        <div role="group" aria-label={t("Whose it is")} className="inline-flex overflow-hidden rounded-full border border-border text-[11.5px]">
          {(["athlete", "coach"] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={o === owner}
              onClick={() => setOwner(o)}
              className={`px-2.5 ${o === owner ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}
            >
              {o === "athlete" ? name : t("You")}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
