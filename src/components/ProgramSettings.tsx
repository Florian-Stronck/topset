"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteProgram,
  importProgram,
  updateBlock,
  updateBlockMaxes,
  updateBlockTargets,
  updateProgram,
} from "@/app/programming/actions";
import { NumberInput, TextInput } from "@/components/cells";
import { Confirm } from "@/components/Confirm";
import { useHistory } from "@/components/history";
import { closeGapUndoable, deletePhaseUndoable } from "@/components/Topbar";
import { describeGap, phaseGaps } from "@/lib/dates";
import type { PhaseSummary, ProgramSummary } from "@/lib/queries";
import type { AthleteData } from "@/lib/types";
import { t } from "@/lib/i18n";

const MAXES = [
  { key: "squat1RM", label: "SQUAT" },
  { key: "bench1RM", label: "BENCH" },
  { key: "dead1RM", label: "DEADLIFT" },
] as const;

const TARGETS = [
  { key: "kcalTarget", label: "KCAL" },
  { key: "proteinTarget", label: "PROTEIN" },
  { key: "carbsTarget", label: "CARBS" },
  { key: "fatTarget", label: "FAT" },
] as const;

/** Saves an edit and puts it on the undo stack. `key` folds repeated saves of one field together. */
function useTracked() {
  const [, startTransition] = useTransition();
  const history = useHistory();
  return function tracked(label: string, run: () => Promise<unknown>, undo: () => Promise<unknown>, key?: string) {
    startTransition(() => {
      void run();
    });
    history.push({ label, undo, redo: run, key });
  };
}

/** The program as a whole: its name, its file, and deleting it. Phases have their own settings. */
export function ProgramSettings({
  program,
  phase,
  athlete,
  onClose,
}: {
  program: ProgramSummary;
  /** The open phase — the export carries the whole program from any of them. */
  phase: PhaseSummary;
  athlete: AthleteData;
  onClose: () => void;
}) {
  const router = useRouter();
  const tracked = useTracked();
  const weeks = program.phases.reduce((n, p) => n + p.weeks.length, 0);

  return (
    <div className="w-[320px]">
      <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("PROGRAM")}</div>
      <Label text={t("NAME")}>
        <TextInput
          value={program.name}
          valid={(v) => v.trim() !== ""}
          onCommit={(v) =>
            v &&
            tracked(
              "rename program",
              () => updateProgram(program.id, { name: v }),
              () => updateProgram(program.id, { name: program.name }),
              `rename program:${program.id}`,
            )
          }
        />
      </Label>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-2">
        {t(program.phases.length === 1 ? "{n} phase" : "{n} phases", { n: program.phases.length })} ·{" "}
        {t(weeks === 1 ? "{n} week" : "{n} weeks", { n: weeks })}
      </p>

      <div className="mt-4 text-[11px] tracking-[0.14em] text-muted-2">{t("PROGRAM FILE")}</div>
      <div className="mt-1.5 flex gap-1.5">
        <a
          href={`/api/export?blockId=${phase.id}&format=json`}
          className="flex-1 rounded border border-border px-2.5 py-1.5 text-center text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          {t("Export .topset.json")}
        </a>
        <ImportButton athleteId={athlete.id} className="flex-1" />
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-2">
        {t("Every phase of this program, its progression rules and their 1RMs. Logged weights and athlete notes stay behind.")}
      </p>

      <div className="mt-4 flex items-center border-t border-border pt-3">
        <Confirm
          label="Delete the program"
          question={t(program.phases.length === 1 ? "Delete “{name}” and its phase?" : "Delete “{name}” and all {n} phases?", { name: program.name, n: program.phases.length })}
          onConfirm={async () => {
            await deleteProgram(program.id);
            onClose();
            router.push(`/programming?athlete=${athlete.id}`);
          }}
        />
      </div>
    </div>
  );
}

/**
 * The open phase: what it is called, when it runs, the 1RMs its target weights come off,
 * what the athlete eats to, and deleting it.
 */
export function PhaseSettings({
  program,
  phase,
  athlete,
  onClose,
}: {
  program: ProgramSummary;
  phase: PhaseSummary;
  athlete: AthleteData;
  onClose: () => void;
}) {
  const router = useRouter();
  const tracked = useTracked();
  const history = useHistory();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const openPhase = (id: string) => router.push(`/programming?athlete=${athlete.id}&phase=${id}`);

  function patchPhase(label: string, data: Parameters<typeof updateBlock>[1], was: Parameters<typeof updateBlock>[1]) {
    tracked(label, () => updateBlock(phase.id, data), () => updateBlock(phase.id, was), `${label}:${phase.id}`);
  }

  return (
    <div className="w-[320px]">
      <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("PHASE")}</div>
      <Label text={t("NAME")}>
        <TextInput value={phase.phase} valid={(v) => v.trim() !== ""} onCommit={(v) => v && patchPhase("rename phase", { phase: v }, { phase: phase.phase })} />
      </Label>

      <div className="mt-2 flex gap-1.5">
        <Label text={t("STARTS")} className="flex-1">
          <input
            type="date"
            value={new Date(phase.startDate).toISOString().slice(0, 10)}
            onChange={(e) => {
              // Typing the year fires on every digit (0002, 0020, 0202…); wait for a real one.
              const year = Number(e.target.value.slice(0, 4));
              if (year >= 1900 && year <= 2200) {
                patchPhase("start date", { startDate: e.target.value }, { startDate: new Date(phase.startDate).toISOString().slice(0, 10) });
              }
            }}
            className="w-full bg-transparent px-2 py-1.5 text-[12px] outline-none"
          />
        </Label>
        <Label text={t("WEEKS")} className="w-[84px]">
          <div
            title={t("Weeks are added and removed from the tabs above the grid")}
            className="px-2 py-1.5 text-[12px] text-muted-2"
          >
            {phase.weeks.length}
          </div>
        </Label>
      </div>
      <GapNotes program={program} phase={phase} />

      <div className="mt-4 text-[11px] tracking-[0.14em] text-muted-2">
        {t("1RM — WHAT THIS PHASE IS CALCULATED FROM")}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {MAXES.map((m) => (
          <Label key={m.key} text={t(m.label)} className="flex-1">
            <NumberInput
              value={phase[m.key]}
              align="left"
              placeholder={athlete[m.key] === null ? "—" : String(athlete[m.key])}
              onCommit={(v) =>
                tracked(
                  "1RM",
                  () => updateBlockMaxes(phase.id, { [m.key]: v }),
                  () => updateBlockMaxes(phase.id, { [m.key]: phase[m.key] }),
                  `1RM:${phase.id}:${m.key}`,
                )
              }
            />
          </Label>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-2">
        {t("In {unit}. Editing these moves this phase’s target weights only — the other phases, and {name}’s own 1RMs, stay as they are.", { unit, name: athlete.name })}
      </p>

      <div className="mt-4 text-[11px] tracking-[0.14em] text-muted-2">{t("NUTRITION — TARGETS PER DAY")}</div>
      <div className="mt-1.5 flex gap-1.5">
        {TARGETS.map((m) => (
          <Label key={m.key} text={t(m.label)} className="flex-1">
            <NumberInput
              value={phase[m.key]}
              align="left"
              onCommit={(v) =>
                tracked(
                  "nutrition target",
                  () => updateBlockTargets(phase.id, { [m.key]: v }),
                  () => updateBlockTargets(phase.id, { [m.key]: phase[m.key] }),
                  `target:${phase.id}:${m.key}`,
                )
              }
            />
          </Label>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-2">
        {t("Kcal, then grams. A day hits when calories land within 10% and protein reaches its target. The next phase starts with these.")}
      </p>

      {program.phases.length > 1 && (
        <div className="mt-4 flex items-center border-t border-border pt-3">
          <Confirm
            label="Delete this phase"
            question={t("Delete the phase “{name}”?", { name: phase.phase })}
            onConfirm={async () => {
              onClose();
              const next = program.phases.find((p) => p.id !== phase.id);
              await deletePhaseUndoable(history, phase.id, openPhase, () =>
                next ? openPhase(next.id) : router.push(`/programming?athlete=${athlete.id}`),
              );
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Breaks and overlaps on either side of this phase. A break is often intended — rest, vacation. */
function GapNotes({ program, phase }: { program: ProgramSummary; phase: PhaseSummary }) {
  const gaps = phaseGaps(program.phases);
  const i = program.phases.findIndex((p) => p.id === phase.id);
  const before = gaps.get(phase.id);
  const nextPhase = program.phases[i + 1];
  const after = nextPhase ? gaps.get(nextPhase.id) : undefined;

  const [pending, startTransition] = useTransition();
  const history = useHistory();

  type Note = { days: number; text: string; fixId: string };
  const notes = [
    before !== undefined && {
      days: before,
      text: t("{gap} after “{phase}”", { gap: describeGap(before), phase: program.phases[i - 1].phase }),
      fixId: phase.id,
    },
    after !== undefined && {
      days: after,
      text: t("{gap} before “{phase}”", { gap: describeGap(after), phase: nextPhase.phase }),
      fixId: nextPhase.id,
    },
  ].filter((n): n is Note => Boolean(n));

  if (notes.length === 0) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {notes.map((n) => (
        <div
          key={n.text}
          className={`flex items-start gap-2 rounded px-2 py-1 text-[11px] leading-snug ${
            n.days > 0 ? "bg-amber-500/10 text-amber-400/90" : "bg-red-500/10 text-red-400"
          }`}
        >
          <span className="flex-1">
            {n.text}
            {n.days > 0 ? t(" — no training then. Fine for rest or vacation.") : t(" — both phases would run at once.")}
          </span>
          <button
            type="button"
            disabled={pending}
            title={t("Start the later phase the day the earlier one ends; phases after it move too")}
            onClick={() =>
              startTransition(async () => {
                await closeGapUndoable(history, n.fixId);
              })
            }
            className="shrink-0 rounded border border-current px-1.5 py-0.5 hover:bg-white/5 disabled:opacity-60"
          >
            {n.days > 0 ? t("Close gap") : t("Fix")}
          </button>
        </div>
      ))}
    </div>
  );
}

function ImportButton({ athleteId, className = "" }: { athleteId: string; className?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className={className}>
      <label
        className={`block cursor-pointer rounded border border-border px-2.5 py-1.5 text-center text-[11px] ${
          pending ? "text-muted-2" : "text-muted hover:border-accent hover:text-accent"
        }`}
      >
        {pending ? t("Importing…") : t("Import .topset.json")}
        <input
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;

            setError(null);
            setPending(true);
            const result = await importProgram(athleteId, await file.text());
            setPending(false);

            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push(`/programming?athlete=${athleteId}&phase=${result.id}`);
          }}
        />
      </label>
      {error && <p className="mt-1 text-[11px] leading-snug text-accent">{error}</p>}
    </div>
  );
}

function Label({
  text,
  children,
  className = "",
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mt-2 ${className}`}>
      <div className="text-[10px] tracking-[0.14em] text-muted-2">{text}</div>
      <div className="mt-0.5 rounded border border-border bg-surface">{children}</div>
    </div>
  );
}
