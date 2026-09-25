"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createAthlete, deleteAthlete, updateAthleteProfile } from "@/app/athletes/actions";
import { AthleteLinkButton } from "@/components/AthleteLink";
import { formKeys, NumberInput, TextInput } from "@/components/cells";
import { useSettings } from "@/components/SettingsProvider";
import { fresh, useCommands, type Command } from "@/lib/commands";
import type { AthleteData } from "@/lib/types";
import { plural, t } from "@/lib/i18n";
import { CheckinQuestions } from "@/components/CheckinQuestions";
import type { CheckinQuestionData } from "@/lib/checkins";

export type RosterEntry = AthleteData & {
  /** Whether a check-in link is out. The link itself is only fetched when asked for. */
  hasLink: boolean;
  /** What the athlete app asks in the check-in, in order. */
  questions: CheckinQuestionData[];
  programs: {
    id: string;
    name: string;
    firstPhaseId: string | null;
    phases: number;
    weeks: number;
  }[];
};

const MAXES = [
  { key: "squat1RM", label: "Squat" },
  { key: "bench1RM", label: "Bench" },
  { key: "dead1RM", label: "Deadlift" },
] as const;

export function Roster({
  athletes,
  openNew = false,
  openLink,
  nonce,
}: {
  athletes: RosterEntry[];
  openNew?: boolean;
  /** An athlete whose check-in link opens straight away — the palette's "Athlete check-in link…". */
  openLink?: string;
  /** Changes with every palette request, so asking again reopens what was closed. */
  nonce?: string;
}) {
  const router = useRouter();
  const commands = useMemo<Command[]>(
    () =>
      athletes.flatMap((a): Command[] => {
        const latest = a.programs[0];
        return [
          {
            id: `roster-maxes-${a.id}`,
            group: "Athlete",
            title: t("Edit {name}'s 1RMs", { name: a.name }),
            keywords: "maxes squat bench deadlift total",
            kind: "athlete",
            run: () => {
              const card = document.querySelector<HTMLElement>(`[data-athlete="${a.id}"]`);
              card?.scrollIntoView({ block: "center", behavior: "smooth" });
              const input = card?.querySelector<HTMLInputElement>("[data-maxes] input");
              input?.focus();
              input?.select();
            },
          },
          {
            id: `roster-link-${a.id}`,
            group: "Athlete",
            title: t("Check-in link for {name}", { name: a.name }),
            keywords: "qr phone share athlete app",
            kind: "athlete",
            run: () => router.push(fresh(`/athletes?link=${a.id}`)),
          },
          ...(latest
            ? [
                {
                  id: `roster-export-${a.id}`,
                  group: "Export",
                  title: t("Export {program} for {name} (.xlsx)", { program: latest.name, name: a.name }),
                  keywords: "excel latest",
                  run: () => {
                    // A download, not a page: a link click keeps the roster on screen.
                    const link = document.createElement("a");
                    link.href = `/api/export?blockId=${latest.id}&format=xlsx`;
                    link.click();
                  },
                },
              ]
            : []),
        ];
      }),
    [athletes, router],
  );
  useCommands("roster", commands);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{t("Athletes")}</h1>
          <p className="mt-1 text-[12px] text-muted">
            {t("{n} on the roster", { n: athletes.length })} ·{" "}
            {plural(athletes.reduce((n, a) => n + a.programs.length, 0), "{n} program", "{n} programs")} ·{" "}
            {t("these are the current bests, and each program keeps the maxes it was written against")}
          </p>
        </div>
        <NewAthleteButton key={`new-${nonce ?? ""}`} initiallyOpen={openNew} />
      </div>

      {athletes.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center text-[13px] text-muted">
          {t("No athletes yet. Add your first one to start programming.")}
        </div>
      ) : (
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {athletes.map((a) => (
            <AthleteCard
              key={a.id === openLink ? `${a.id}-${nonce ?? ""}` : a.id}
              athlete={a}
              linkOpen={a.id === openLink}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AthleteCard({ athlete, linkOpen }: { athlete: RosterEntry; linkOpen: boolean }) {
  const [, startTransition] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const total = MAXES.reduce((sum, m) => sum + (athlete[m.key] ?? 0), 0);
  const latest = athlete.programs[0];

  function patch(data: Parameters<typeof updateAthleteProfile>[1]) {
    startTransition(() => {
      void updateAthleteProfile(athlete.id, data);
    });
  }

  return (
    <div data-athlete={athlete.id} className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
          {athlete.name.slice(0, 1).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <div className="-ml-2">
            <TextInput
              value={athlete.name}
              placeholder={t("Athlete name")}
              onCommit={(v) => v && patch({ name: v })}
              className="!text-[15px] font-semibold"
            />
          </div>
          <div className="mt-0.5 pl-0.5 text-[11px] text-muted-2">
            {plural(athlete.programs.length, "{n} program", "{n} programs")}
            {latest ? ` · ${t("latest")}: ${latest.name}` : ""}
          </div>
        </div>

        <UnitToggle unit={athlete.unit} onChange={(u) => patch({ unit: u })} />
      </div>

      <div data-maxes className="mt-3 flex items-center gap-2">
        {MAXES.map((m) => (
          <div key={m.key} className="flex-1 rounded-lg border border-border bg-surface-2 px-2 py-1.5">
            <div className="text-[10px] tracking-[0.14em] text-muted-2">{t(m.label).toUpperCase()}</div>
            <NumberInput
              value={athlete[m.key]}
              align="left"
              onCommit={(v) => patch({ [m.key]: v })}
              className="!px-0 !text-[13px]"
            />
          </div>
        ))}
        <div className="flex-1 px-2 py-1.5">
          <div className="text-[10px] tracking-[0.14em] text-muted-2">{t("TOTAL")}</div>
          <div className="py-1.5 text-[13px] text-foreground">
            {total > 0 ? `${Math.round(total * 10) / 10} ${unit}` : "—"}
          </div>
        </div>
      </div>

      <CheckinQuestions athleteId={athlete.id} questions={athlete.questions} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/programming?athlete=${athlete.id}`}
          className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
        >
          {t("Open programming")}
        </Link>
        {latest && (
          <a
            href={`/api/export?blockId=${latest.id}&format=xlsx`}
            className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground"
          >
            {t("Export latest")}
          </a>
        )}
        <AthleteLinkButton athleteId={athlete.id} name={athlete.name} hasLink={athlete.hasLink} initiallyOpen={linkOpen} />
        <DeleteAthleteButton athlete={athlete} />
      </div>
    </div>
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
  const [form, setForm] = useState({
    name: "",
    unit: defaultUnit as AthleteData["unit"],
    squat1RM: "",
    bench1RM: "",
    dead1RM: "",
  });

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
    setForm({ name: "", unit: defaultUnit, squat1RM: "", bench1RM: "", dead1RM: "" });
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
