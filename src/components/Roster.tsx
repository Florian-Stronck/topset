"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react";
import { createAthlete, deleteAthlete, updateAthleteProfile } from "@/app/athletes/actions";
import { setAthleteTeam } from "@/app/settings/cloud-actions";
import { AthleteLinkButton } from "@/components/AthleteLink";
import { formKeys, NumberInput, TextInput } from "@/components/cells";
import { parseVariationPcts } from "@/lib/intensity";
import type { CheckinStatus } from "@/lib/overview";
import { library } from "@/lib/exercises";
import { ExerciseInput } from "@/components/ExerciseInput";
import { useSettings } from "@/components/SettingsProvider";
import { fresh, useCommands, type Command } from "@/lib/commands";
import type { AthleteData } from "@/lib/types";
import { plural, t } from "@/lib/i18n";
import { tutorialDid } from "@/components/Tutorial";
import { CheckinQuestions } from "@/components/CheckinQuestions";
import type { CheckinQuestionData } from "@/lib/checkins";

export type RosterEntry = AthleteData & {
  /** Whether a check-in link is out. The link itself is only fetched when asked for. */
  hasLink: boolean;
  /** Whether a read-only Tracking link for a second coach is out. */
  hasViewLink: boolean;
  /** How recently they checked in, by the Overview's rule. */
  checkin: CheckinStatus;
  /** The team the athlete is shared with, if any. */
  teamId: string | null;
  team: string | null;
  /** A teammate's athlete: theirs to share or delete, everyone's to edit. */
  theirs: boolean;
  /** What the athlete app asks in the check-in, in order. */
  questions: CheckinQuestionData[];
  /** The coach's own notes, never shown to the athlete. */
  notes: string | null;
  nextMeet: { name: string; date: string; days: number; weightClass: string | null } | null;
  /** Injuries still open today, worst first. */
  injuries: { label: string; severity: number; since: string }[];
  /** Oldest first. */
  programs: {
    id: string;
    name: string;
    firstPhaseId: string | null;
    phases: number;
    weeks: number;
    /** "1 Sep – 12 Oct"; null with no phases. */
    dates: string | null;
    status: "upcoming" | "active" | "done" | null;
  }[];
};

const MAXES = [
  { key: "squat1RM", label: "Squat" },
  { key: "bench1RM", label: "Bench" },
  { key: "dead1RM", label: "Deadlift" },
] as const;

export function Roster({
  athletes,
  teams = [],
  picked,
  openNew = false,
  openLink,
  nonce,
}: {
  athletes: RosterEntry[];
  /** The teams the coach is on, to share their own athletes with. */
  teams?: { id: string; name: string }[];
  /** The athlete shown, picked in the sidebar; the first one when none is. */
  picked?: string;
  openNew?: boolean;
  /** An athlete whose check-in link opens straight away — the palette's "Athlete check-in link…". */
  openLink?: string;
  /** Changes with every palette request, so asking again reopens what was closed. */
  nonce?: string;
}) {
  const router = useRouter();
  const selected = athletes.find((a) => a.id === picked) ?? athletes[0];

  /** Shows the athlete, then puts the caret in one of their boxes once it's drawn. */
  const focusIn = useCallback((id: string, selector: string) => {
    router.push(`/athletes?athlete=${id}`);
    // Drawn once the server answers; a few tries cover a slow one.
    let tries = 0;
    const attempt = () => {
      const input = document.querySelector<HTMLInputElement>(`[data-athlete="${id}"] ${selector}`);
      if (input) {
        input.focus();
        input.select();
      } else if (tries++ < 20) setTimeout(attempt, 100);
    };
    attempt();
  }, [router]);

  const commands = useMemo<Command[]>(
    () =>
      athletes.flatMap((a): Command[] => {
        const latest = a.programs[a.programs.length - 1];
        return [
          {
            id: `roster-maxes-${a.id}`,
            group: "Athlete",
            title: t("Edit {name}'s 1RMs", { name: a.name }),
            keywords: "maxes squat bench deadlift total",
            kind: "athlete",
            run: () => focusIn(a.id, "[data-maxes] input"),
          },
          {
            id: `roster-variations-${a.id}`,
            group: "Athlete",
            title: t("Variation drop-off for {name}", { name: a.name }),
            keywords: "variation percent max paused pin tempo",
            kind: "athlete",
            run: () => focusIn(a.id, "[data-variations] input"),
          },
          {
            id: `roster-notes-${a.id}`,
            group: "Athlete",
            title: t("Notes on {name}", { name: a.name }),
            keywords: "notes goals history memo",
            kind: "athlete",
            run: () => focusIn(a.id, "[data-notes]"),
          },
          {
            id: `roster-link-${a.id}`,
            group: "Athlete",
            title: t("Check-in link for {name}", { name: a.name }),
            keywords: "qr phone share athlete app",
            kind: "athlete",
            run: () => router.push(fresh(`/athletes?link=${a.id}`)),
          },
          ...(latest?.firstPhaseId
            ? [
                {
                  id: `roster-export-${a.id}`,
                  group: "Export",
                  title: t("Export {program} for {name} (.xlsx)", { program: latest.name, name: a.name }),
                  keywords: "excel latest",
                  run: () => {
                    // A download, not a page: a link click keeps the roster on screen.
                    const link = document.createElement("a");
                    link.href = `/api/export?blockId=${latest.firstPhaseId}&format=xlsx`;
                    link.click();
                  },
                },
              ]
            : []),
        ];
      }),
    [athletes, router, focusIn],
  );
  useCommands("roster", commands);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{t("Athletes")}</h1>
          <p className="mt-1 text-[12px] text-muted">
            {t("{n} on the roster", { n: athletes.length })} ·{" "}
            {plural(athletes.reduce((n, a) => n + a.programs.length, 0), "{n} program", "{n} programs")}
          </p>
        </div>
        <NewAthleteButton key={`new-${nonce ?? ""}`} initiallyOpen={openNew} />
      </div>

      {athletes.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center text-[13px] text-muted">
          {t("No athletes yet. Add your first one to start programming.")}
        </div>
      ) : (
        <div className="mt-6">
          <AthleteCard
            key={selected.id === openLink ? `${selected.id}-${nonce ?? ""}` : selected.id}
            athlete={selected}
            teams={teams}
            linkOpen={selected.id === openLink}
          />
        </div>
      )}
    </div>
  );
}

/** One labelled band of the athlete panel. */
function Band({ label, hint, aside, children }: { label: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-border py-4 sm:grid-cols-[84px_minmax(0,1fr)]">
      <div className="pt-1 text-[10px] tracking-[0.14em] text-muted-2" title={hint}>
        {label}
        {hint && <span className="ml-1 cursor-help">ⓘ</span>}
        {aside && <div className="mt-2">{aside}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

const STATUS_LOOK = {
  active: { cls: "bg-ok/15 text-ok-text", label: "active" },
  upcoming: { cls: "bg-surface-3 text-muted", label: "upcoming" },
  done: { cls: "text-muted-2", label: "done" },
} as const;

/** A link's state beside its button: whether one has been handed out. */
function LinkState({ sent }: { sent: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-2">
      <span aria-hidden className={`size-1.5 rounded-full ${sent ? "bg-ok" : "bg-muted-2"}`} />
      {sent ? t("sent") : t("not sent yet")}
    </span>
  );
}

/** Saved on the way out, so typing never waits on the server. */
function NotesField({ value, onCommit }: { value: string | null; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <textarea
      data-notes
      value={draft}
      rows={3}
      placeholder={t("Goals, history, anything to remember. Only you see this.")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value ?? "") && onCommit(draft)}
      className="w-full resize-y rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-[12px] leading-relaxed outline-none placeholder:text-muted-2 hover:border-muted-2 focus:border-accent"
    />
  );
}

function AthleteCard({ athlete, teams, linkOpen }: { athlete: RosterEntry; teams: { id: string; name: string }[]; linkOpen: boolean }) {
  const [, startTransition] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const total = MAXES.reduce((sum, m) => sum + (athlete[m.key] ?? 0), 0);

  function patch(data: Parameters<typeof updateAthleteProfile>[1]) {
    startTransition(() => {
      void updateAthleteProfile(athlete.id, data);
    });
  }

  // Looks like text until pointed at: then it shows it can be typed in.
  const editable = "rounded-lg border border-transparent hover:border-border focus-within:border-accent";

  return (
    <div data-athlete={athlete.id} className="rounded-xl border border-border bg-surface px-5 pt-5">
      <div className="flex flex-wrap items-start gap-3 pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-[16px] font-semibold text-accent">
          {athlete.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className={`-ml-2 max-w-[360px] ${editable}`} title={t("Click to rename")}>
            <TextInput
              value={athlete.name}
              placeholder={t("Athlete name")}
              onCommit={(v) => v && patch({ name: v })}
              className="!text-[18px] font-semibold"
            />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-0.5 text-[11px] text-muted-2">
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE[athlete.checkin.tone]}`} />
            {athlete.checkin.label}
            {athlete.team ? ` · ${t("Shared with {team}", { team: athlete.team })}` : ""}
          </div>
        </div>
        <Link
          href={`/programming?athlete=${athlete.id}`}
          className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
        >
          {t("Open programming")}
        </Link>
      </div>

      <div className="grid lg:grid-cols-2">
        <div className="lg:border-r lg:border-border lg:pr-6">
          <Band
            label={t("MAXES")}
            hint={t("These are the current bests; each program keeps the maxes it was written against.")}
            aside={<UnitToggle unit={athlete.unit} onChange={(u) => patch({ unit: u })} />}
          >
            <div data-maxes className="flex flex-wrap items-center gap-2">
              {MAXES.map((m) => (
                <div
                  key={m.key}
                  className="w-[76px] cursor-text rounded-lg border border-border bg-surface-2 px-2 py-1.5 hover:border-muted-2 focus-within:border-accent"
                >
                  <div className="text-[10px] tracking-[0.14em] text-muted-2">{t(m.label).toUpperCase()}</div>
                  <NumberInput
                    value={athlete[m.key]}
                    align="left"
                    onCommit={(v) => patch({ [m.key]: v })}
                    className="!px-0 !text-[14px]"
                  />
                </div>
              ))}
              <div className="px-2 py-1.5">
                <div className="text-[10px] tracking-[0.14em] text-muted-2">{t("TOTAL")}</div>
                <div className="py-1 text-[14px] font-medium text-foreground">
                  {total > 0 ? `${Math.round(total * 10) / 10} ${unit}` : "—"}
                </div>
              </div>
            </div>
          </Band>

          <Band label={t("VARIATIONS")}>
            <VariationDropoffs athlete={athlete} patch={patch} />
          </Band>

          <Band label={t("NEXT MEET")}>
            {athlete.nextMeet ? (
              <Link href={`/competition?athlete=${athlete.id}`} className="group block text-[12px]">
                <span className="font-medium group-hover:text-accent">{athlete.nextMeet.name}</span>
                <span className="text-muted-2">
                  {" · "}
                  {athlete.nextMeet.date} · {t("in {n} days", { n: athlete.nextMeet.days })}
                  {athlete.nextMeet.weightClass ? ` · ${athlete.nextMeet.weightClass}` : ""}
                </span>
              </Link>
            ) : (
              <Link href={`/competition?athlete=${athlete.id}`} className="text-[12px] text-muted-2 hover:text-accent">
                {t("None planned")} · {t("Add one")} →
              </Link>
            )}
          </Band>

          <Band label={t("INJURIES")}>
            {athlete.injuries.length === 0 ? (
              <span className="text-[12px] text-muted-2">{t("None open")}</span>
            ) : (
              <Link href={`/tracking?athlete=${athlete.id}&view=wellness`} className="flex flex-col gap-1 text-[12px]">
                {athlete.injuries.map((i, n) => (
                  <span key={n} className="flex items-center gap-1.5">
                    <span aria-hidden className={`size-1.5 rounded-full ${i.severity >= 4 ? "bg-miss" : "bg-warn"}`} />
                    <span className="font-medium">{i.label}</span>
                    <span className="text-muted-2">
                      {i.severity}/5 · {t("since {date}", { date: i.since })}
                    </span>
                  </span>
                ))}
              </Link>
            )}
          </Band>
        </div>

        <div className="lg:pl-6">
          <Band label={t("CHECK-IN")}>
            <CheckinQuestions athleteId={athlete.id} questions={athlete.questions} />
          </Band>

          <Band label={t("PROGRAMS")}>
            {athlete.programs.length === 0 ? (
              <span className="text-[12px] text-muted-2">{t("No program yet")}</span>
            ) : (
              <div className="flex flex-col gap-1.5">
                {[...athlete.programs].reverse().map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                    <Link href={`/programming?athlete=${athlete.id}&program=${p.id}`} className="font-medium hover:text-accent">
                      {p.name}
                    </Link>
                    {p.status && (
                      <span className={`rounded-full px-1.5 py-px text-[10px] ${STATUS_LOOK[p.status].cls}`}>
                        {t(STATUS_LOOK[p.status].label)}
                      </span>
                    )}
                    <span className="text-muted-2">
                      {p.dates ? `${p.dates} · ` : ""}
                      {plural(p.phases, "{n} phase", "{n} phases")} · {plural(p.weeks, "{n} week", "{n} weeks")}
                    </span>
                    {p.firstPhaseId && (
                      <a
                        href={`/api/export?blockId=${p.firstPhaseId}&format=xlsx`}
                        className="ml-auto text-[11px] text-muted hover:text-foreground"
                      >
                        {t("Export")}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Band>

          <Band label={t("SHARING")}>
            <div className="flex flex-col gap-2">
              <div data-tour="athlete-link" className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <AthleteLinkButton athleteId={athlete.id} name={athlete.name} hasLink={athlete.hasLink} initiallyOpen={linkOpen} />
                  <LinkState sent={athlete.hasLink} />
                </div>
                <div className="flex items-center gap-2">
                  <AthleteLinkButton kind="viewer" athleteId={athlete.id} name={athlete.name} hasLink={athlete.hasViewLink} />
                  <LinkState sent={athlete.hasViewLink} />
                </div>
              </div>
              {!athlete.theirs && teams.length > 0 && <TeamPicker athlete={athlete} teams={teams} />}
            </div>
          </Band>

          <Band label={t("NOTES")}>
            <NotesField value={athlete.notes} onCommit={(v) => patch({ notes: v })} />
          </Band>
        </div>
      </div>

      {!athlete.theirs && (
        <div className="flex justify-end border-t border-border py-3">
          <DeleteAthleteButton athlete={athlete} />
        </div>
      )}
    </div>
  );
}

const TONE = { ok: "bg-ok", warn: "bg-warn", miss: "bg-miss" } as const;

/**
 * How far under the competition max this athlete trains variations, as a small sheet:
 * the default first, then any exercise that sits elsewhere (a paused squat at 85, a
 * board press at 110). The blank last row adds one, with the grid's Tab completion.
 */
function VariationDropoffs({
  athlete,
  patch,
}: {
  athlete: RosterEntry;
  patch: (data: Parameters<typeof updateAthleteProfile>[1]) => void;
}) {
  const fallback = useSettings().settings.variationPercent;
  const own = parseVariationPcts(athlete.variationPcts);
  const base = athlete.variationPct ?? fallback;
  const names = library()
    .entries.filter((e) => e.tier === "VARIATION")
    .map((e) => e.name);
  // Remounts the blank row after each add, so it comes back empty.
  const [added, setAdded] = useState(0);

  const save = (next: Record<string, number>) =>
    patch({ variationPcts: Object.keys(next).length > 0 ? JSON.stringify(next) : null });

  function rename(from: string, to: string | null) {
    const name = to?.trim() ?? "";
    if (name === from) return;
    // Rebuilt in order, so a renamed row stays where it was.
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(own)) {
      if (k === from) {
        if (name && !(name in own)) next[name] = v;
      } else next[k] = v;
    }
    save(next);
  }

  const cell = "border-b border-r border-border px-0.5";
  const head = "border-b border-r border-border px-2 py-1 text-left text-[10px] font-normal tracking-[0.14em] text-muted-2";

  return (
    <table data-variations className="w-full max-w-[340px] border-separate border-spacing-0 overflow-hidden rounded-lg border-l border-t border-border text-[12px]">
      <thead>
        <tr>
          <th className={head}>{t("EXERCISE")}</th>
          <th className={`${head} w-[80px] text-right`}>{t("% MAX")}</th>
        </tr>
      </thead>
      <tbody>
        <tr className="bg-surface-2">
          <td className={`${cell} px-2 font-medium`}>{t("Default")}</td>
          <td className={cell}>
            <NumberInput
              value={athlete.variationPct}
              placeholder={String(fallback)}
              align="right"
              onCommit={(v) => patch({ variationPct: v })}
              className="!text-[12px]"
            />
          </td>
        </tr>
        {Object.entries(own).map(([name, pct]) => (
          <tr key={name}>
            <td className={cell}>
              <ExerciseInput value={name} history={names} onCommit={(v) => rename(name, v)} className="!text-[12px]" />
            </td>
            <td className={cell}>
              <NumberInput
                value={pct}
                align="right"
                onCommit={(v) => {
                  const next = { ...own };
                  if (v === null || v <= 0) delete next[name];
                  else next[name] = v;
                  save(next);
                }}
                className="!text-[12px]"
              />
            </td>
          </tr>
        ))}
        <tr>
          <td className={cell}>
            <ExerciseInput
              key={added}
              value=""
              history={names.filter((n) => !(n in own))}
              placeholder={t("+ exercise")}
              onCommit={(v) => {
                const name = v?.trim();
                if (!name || name in own) return;
                save({ ...own, [name]: base });
                setAdded((n) => n + 1);
                // The fresh blank row takes the caret, so a list goes in without the mouse.
                setTimeout(() => document.querySelector<HTMLInputElement>(`[data-athlete="${athlete.id}"] [data-variations] tr:last-child input`)?.focus(), 50);
              }}
              className="!text-[12px]"
            />
          </td>
          <td className={`${cell} px-2 text-right text-muted-2`}>{base}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Which of the coach's teams sees this athlete too. Needs the server, so it can say no. */
function TeamPicker({ athlete, teams }: { athlete: RosterEntry; teams: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted" title={error ?? undefined}>
      {t("Team")}
      <select
        value={athlete.teamId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const teamId = e.target.value || null;
          startTransition(async () => setError((await setAthleteTeam(athlete.id, teamId)).error ?? null));
        }}
        className={`rounded-lg border bg-surface px-2 py-1 text-[12px] ${error ? "border-red-400 text-red-400" : "border-border"}`}
      >
        <option value="">{t("Not shared")}</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function UnitToggle({
  unit,
  onChange,
}: {
  unit: AthleteData["unit"];
  onChange: (u: AthleteData["unit"]) => void;
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-full border border-border text-[11px]">
      {(["KG", "LB"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => u !== unit && onChange(u)}
          className={`px-2.5 py-1 ${
            u === unit
              ? "bg-accent-soft font-medium text-accent"
              : "text-muted-2 hover:text-foreground"
          }`}
        >
          {u.toLowerCase()}
        </button>
      ))}
    </div>
  );
}

function DeleteAthleteButton({ athlete }: { athlete: RosterEntry }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="ml-auto rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-2 hover:border-accent hover:text-accent"
      >
        {t("Remove")}
      </button>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="text-[11px] text-muted">
        {t(athlete.programs.length === 1 ? "Delete {name} and {n} program?" : "Delete {name} and {n} programs?", { name: athlete.name, n: athlete.programs.length })}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          await deleteAthlete(athlete.id);
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

export function NewAthleteButton({
  compact = false,
  initiallyOpen = false,
}: {
  compact?: boolean;
  initiallyOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [pending, setPending] = useState(false);
  const { defaultUnit } = useSettings().settings;
  const blank = () => ({
    name: "",
    unit: defaultUnit as AthleteData["unit"],
    squat1RM: "",
    bench1RM: "",
    dead1RM: "",
  });
  const [form, setForm] = useState(blank);

  const field =
    "w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";

  function num(v: string) {
    const n = Number(v.trim());
    return v.trim() === "" || Number.isNaN(n) ? null : n;
  }

  async function submit() {
    setPending(true);
    const id = await createAthlete({
      name: form.name,
      unit: form.unit,
      squat1RM: num(form.squat1RM),
      bench1RM: num(form.bench1RM),
      dead1RM: num(form.dead1RM),
    });
    setPending(false);
    setOpen(false);
    setForm(blank());
    tutorialDid("athlete");
    router.push(`/programming?athlete=${id}`);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          compact
            ? "w-full rounded-lg border border-dashed border-border px-3 py-2 text-left text-[12px] text-muted-2 hover:border-accent hover:text-accent"
            : "rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white hover:opacity-90"
        }
      >
        {t("+ Add athlete")}
      </button>

      {open && (
        <div
          onKeyDown={formKeys(submit, () => setOpen(false), pending)}
          className={`absolute top-full z-40 mt-2 w-[268px] rounded-lg border border-border bg-surface-2 p-3 text-left shadow-xl shadow-black/50 ${
            compact ? "left-0" : "right-0"
          }`}
        >
          <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("NEW ATHLETE")}</div>

          <input
            autoFocus
            value={form.name}
            placeholder={t("Full name")}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={`mt-2 ${field}`}
          />

          <select
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value as AthleteData["unit"] })}
            className={`mt-1.5 cursor-pointer ${field}`}
          >
            <option value="KG">{t("kg")}</option>
            <option value="LB">{t("lb")}</option>
          </select>

          <div className="mt-1.5 flex gap-1.5">
            {(["squat1RM", "bench1RM", "dead1RM"] as const).map((k, i) => (
              <input
                key={k}
                inputMode="decimal"
                value={form[k]}
                placeholder={["SQ", "BP", "DL"][i]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className={field}
              />
            ))}
          </div>

          <div className="mt-2.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
            >
              {pending ? t("Adding…") : t("Add")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
