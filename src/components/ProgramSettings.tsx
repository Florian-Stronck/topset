"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  closePhaseGap,
  deleteBlock,
  deleteProgram,
  importProgram,
  updateBlock,
  updateBlockMaxes,
  updateProgram,
} from "@/app/programming/actions";
import { NumberInput, TextInput } from "@/components/cells";
import { Confirm } from "@/components/Confirm";
import { describeGap, phaseGaps } from "@/lib/dates";
import { restoreBackup, type RestoreStatus } from "@/lib/pick-file";
import type { PhaseSummary, ProgramSummary } from "@/lib/queries";
import type { AthleteData } from "@/lib/types";
import { t } from "@/lib/i18n";

const MAXES = [
  { key: "squat1RM", label: "SQUAT" },
  { key: "bench1RM", label: "BENCH" },
  { key: "dead1RM", label: "DEADLIFT" },
] as const;

/**
 * The program's name, then everything about the phase that is open: when it runs, the
 * 1RMs its target weights come off, the files, and the two deletes.
 */
export function ProgramSettings({
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
  const [, startTransition] = useTransition();
  const unit = athlete.unit === "LB" ? "lb" : "kg";

  function patchPhase(data: Parameters<typeof updateBlock>[1]) {
    startTransition(() => {
      void updateBlock(phase.id, data);
    });
  }

  return (
    <div className="w-[320px]">
      <div className="text-[11px] tracking-[0.14em] text-muted-2">{t("PROGRAM")}</div>
      <Label text={t("NAME")}>
        <TextInput
          value={program.name}
          onCommit={(v) =>
            v &&
            startTransition(() => {
              void updateProgram(program.id, { name: v });
            })
          }
        />
      </Label>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-2">
        {program.phases.length} phase{program.phases.length === 1 ? "" : "s"}, added from the
        row under the topbar.
      </p>

      <div className="mt-4 text-[11px] tracking-[0.14em] text-muted-2">{t("THIS PHASE")}</div>
      <Label text={t("NAME")}>
        <TextInput value={phase.phase} onCommit={(v) => v && patchPhase({ phase: v })} />
      </Label>

      <div className="mt-2 flex gap-1.5">
        <Label text="STARTS" className="flex-1">
          <input
            type="date"
            value={new Date(phase.startDate).toISOString().slice(0, 10)}
            onChange={(e) => e.target.value && patchPhase({ startDate: e.target.value })}
            className="w-full bg-transparent px-2 py-1.5 text-[12px] outline-none"
          />
        </Label>
        <Label text="WEEKS" className="w-[84px]">
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
              onCommit={(v) =>
                startTransition(() => {
                  void updateBlockMaxes(phase.id, { [m.key]: v });
                })
              }
            />
          </Label>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-2">
        In {unit}. Editing these moves this phase&rsquo;s target weights only — the other phases,
        and {athlete.name}&rsquo;s own 1RMs, stay as they are.
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

      <div className="mt-4 text-[11px] tracking-[0.14em] text-muted-2">{t("REPWISE — THIS PHASE")}</div>
      <div className="mt-1.5 flex gap-1.5">
        <a
          href={`/api/export?blockId=${phase.id}&format=repwise`}
          className="flex-1 rounded border border-border px-2.5 py-1.5 text-center text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          {t("Sheet (.xlsx)")}
        </a>
        <a
          href={`/api/export?blockId=${phase.id}&format=repwise-tsv`}
          className="flex-1 rounded border border-border px-2.5 py-1.5 text-center text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          {t("Paste (.tsv)")}
        </a>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-2">
        {t("RPECALC’s layout: one tab per week, day headers, sets/reps/RPE. The .tsv is for pasting straight into a Google Sheet tab.")}
      </p>

      <div className="mt-4 text-[11px] tracking-[0.14em] text-muted-2">{t("BACKUP — EVERYTHING")}</div>
      <BackupButtons />

      <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
        {program.phases.length > 1 && (
          <Confirm
            label="Delete this phase"
            question={t("Delete the phase “{name}”?", { name: phase.phase })}
            onConfirm={async () => {
              await deleteBlock(phase.id);
              onClose();
              const next = program.phases.find((p) => p.id !== phase.id);
              router.push(
                next
                  ? `/programming?athlete=${athlete.id}&phase=${next.id}`
                  : `/programming?athlete=${athlete.id}`,
              );
            }}
          />
        )}

        <Confirm
          label="Delete the program"
          question={t("Delete “{name}” and all {n} phases?", { name: program.name, n: program.phases.length })}
          className="ml-auto"
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

/** Reads a file in the browser and hands the text to the server action. */
/**
 * Every athlete and program in one file. Restoring doesn't touch the open database — the
 * desktop app swaps the file in when it next starts, and keeps a copy of what it replaced.
 */
function BackupButtons() {
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const [pending, setPending] = useState(false);

  async function restore(file: File) {
    setPending(true);
    setStatus(null);
    try {
      setStatus(await restoreBackup(file));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="mt-1.5 flex gap-1.5">
        <a
          href="/api/backup"
          download
          className="flex-1 rounded border border-border px-2.5 py-1.5 text-center text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          {t("Download backup")}
        </a>
        <label
          className={`flex-1 cursor-pointer rounded border border-border px-2.5 py-1.5 text-center text-[11px] ${
            pending ? "text-muted-2" : "text-muted hover:border-accent hover:text-accent"
          }`}
        >
          {pending ? t("Checking…") : t("Restore backup…")}
          <input
            type="file"
            accept=".db"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void restore(file);
            }}
          />
        </label>
      </div>
      {status && (
        <p
          className={`mt-1.5 rounded px-2 py-1 text-[11px] leading-snug ${
            status.tone === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
          }`}
        >
          {status.text}
        </p>
      )}
      <p className="mt-1.5 text-[11px] leading-snug text-muted-2">
        {t("All athletes and programs. Topset also keeps a copy each day it opens, the last 14, in the topset-backups folder beside the app.")}
      </p>
    </>
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
            {n.days > 0 ? " — no training then. Fine for rest or vacation." : " — both phases would run at once."}
          </span>
          <button
            type="button"
            disabled={pending}
            title={t("Start the later phase the day the earlier one ends; phases after it move too")}
            onClick={() =>
              startTransition(async () => {
                await closePhaseGap(n.fixId);
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
