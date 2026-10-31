"use client";

import type { AttemptResult, MeetLift } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useCoachActions } from "@/components/CoachActions";
import { ATTEMPT_ROWS, best, currentAttempt, LIFT_LABEL, MEET_LIFTS, type MeetData } from "@/lib/competition";
import { t } from "@/lib/i18n";
import { loadBar, PLATE_SETS } from "@/lib/plates";
import type { AthleteData } from "@/lib/types";

type Spot = { lift: MeetLift; number: number };

const MAX: Record<MeetLift, "squat1RM" | "bench1RM" | "dead1RM"> = { SQUAT: "squat1RM", BENCH: "bench1RM", DEADLIFT: "dead1RM" };

/**
 * Meet day on the coach's phone: the attempt that's up next large — its weight between big
 * steppers, its share of the max, the rack heights and the plates — called good or no lift
 * with one tap, which moves on to the next. The other attempts sit below, three a lift; a
 * tap on one brings it up to change or call again.
 */
export function PhoneAttempts({ athlete, meet, readOnly }: { athlete: AthleteData; meet: MeetData; readOnly: boolean }) {
  const router = useRouter();
  const { updateAttempt, planFromMaxes } = useCoachActions();
  const [attempts, setAttempts] = useState(meet.attempts);
  const [synced, setSynced] = useState(meet.attempts);
  const [picked, setPicked] = useState<Spot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (synced !== meet.attempts) {
    setSynced(meet.attempts);
    setAttempts(meet.attempts);
  }

  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const step = athlete.unit === "LB" ? 5 : 2.5;
  const find = (s: Spot) => attempts.find((a) => a.lift === s.lift && a.number === s.number);
  const focus: Spot | null = picked ?? currentAttempt(attempts);
  const at = focus ? find(focus) : undefined;
  const weight = at?.weight ?? null;
  const max = focus ? athlete[MAX[focus.lift]] : null;
  const rack = focus?.lift === "SQUAT" ? [meet.racks.squat && `${t("Rack")} ${meet.racks.squat}`, meet.racks.safety && `${t("Safeties")} ${meet.racks.safety}`] : focus?.lift === "BENCH" ? [meet.racks.bench && `${t("Rack")} ${meet.racks.bench}`, meet.racks.safety && `${t("Safeties")} ${meet.racks.safety}`] : [];
  const plates = weight !== null ? loadBar(weight, PLATE_SETS[athlete.unit]).perSide : [];
  const totals = MEET_LIFTS.map((l) => best(attempts, l) ?? 0);
  const total = totals.every((v) => v > 0) ? totals.reduce((a, b) => a + b, 0) : null;
  const empty = attempts.every((a) => a.weight === null);

  function write(spot: Spot, patch: { weight?: number | null; result?: AttemptResult }, then?: () => void) {
    setAttempts((list) => list.map((a) => (a.lift === spot.lift && a.number === spot.number ? { ...a, ...patch } : a)));
    then?.();
    setError(null);
    start(async () => {
      try {
        await updateAttempt(meet.id, spot.lift, spot.number, patch);
        router.refresh();
      } catch (e) {
        setError(t(e instanceof Error ? e.message : "Something went wrong."));
      }
    });
  }

  return (
    <div className={`flex flex-col gap-3 ${readOnly ? "pointer-events-none" : ""}`}>
      <div className="flex items-end justify-between">
        <span className="text-[13px] text-muted">{[meet.weightClass, meet.federation].filter(Boolean).join(" · ")}</span>
        <span className="text-right">
          <span className="block text-[24px] font-bold tabular-nums text-accent">{total ?? "—"}</span>
          <span className="block text-[11px] text-muted">{t("total")}</span>
        </span>
      </div>

      {empty ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => void (await planFromMaxes(meet.id), router.refresh()))}
          className="min-h-14 rounded-2xl border border-dashed border-border text-[15px] text-muted"
        >
          {t("Plan the attempts off the 1RMs")}
        </button>
      ) : focus ? (
        <section className="flex flex-col gap-3.5 rounded-3xl border-2 border-accent bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold tracking-[0.12em] text-accent">{picked ? t("ATTEMPT") : t("UP NEXT")}</span>
            <span className="text-[13px] text-muted">
              {t(LIFT_LABEL[focus.lift])} · {t("attempt {n}", { n: focus.number })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <button type="button" aria-label={t("Lighter")} onClick={() => write(focus, { weight: Math.max(0, (weight ?? 0) - step) })} className="grid size-15 place-items-center rounded-full border border-border bg-background text-[26px]">
              −
            </button>
            <span className="text-center">
              <span className="block text-[46px] font-bold leading-none tabular-nums">{weight ?? "—"}</span>
              <span className="mt-1 block text-[13px] text-muted">{weight !== null && max ? t("{n}% of the {max} max", { n: Math.round((weight / max) * 100), max }) : unit}</span>
            </span>
            <button type="button" aria-label={t("Heavier")} onClick={() => write(focus, { weight: (weight ?? max ?? 0) + step })} className="grid size-15 place-items-center rounded-full border border-border bg-background text-[26px]">
              +
            </button>
          </div>
          {(rack.some(Boolean) || plates.length > 0) && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {rack.filter(Boolean).map((r) => (
                <span key={r as string} className="flex h-7 items-center rounded-full bg-surface-2 px-2.5 text-[12px] text-muted">{r}</span>
              ))}
              {plates.length > 0 && <span className="flex h-7 items-center rounded-full bg-surface-2 px-2.5 text-[12px] text-muted">{t("Plates")}: {plates.join(" ")}</span>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" disabled={weight === null} onClick={() => write(focus, { result: "GOOD" }, () => setPicked(null))} className="h-14 rounded-2xl bg-ok text-[16px] font-bold text-white disabled:opacity-40">
              {t("Good lift")}
            </button>
            <button type="button" disabled={weight === null} onClick={() => write(focus, { result: "MISS" }, () => setPicked(null))} className="h-14 rounded-2xl border-2 border-miss text-[16px] font-bold text-miss disabled:opacity-40">
              {t("No lift")}
            </button>
          </div>
          {at && at.result !== "PENDING" && (
            <button type="button" onClick={() => write(focus, { result: "PENDING" })} className="text-[13px] text-muted">
              {t("Take the call back")}
            </button>
          )}
        </section>
      ) : (
        <p className="rounded-2xl bg-ok/15 px-4 py-3 text-center text-[15px] text-ok">{t("Every attempt is called.")}</p>
      )}

      {MEET_LIFTS.map((lift) => (
        <div key={lift} className="flex min-h-13 items-center gap-2.5 rounded-2xl border border-border bg-surface px-3.5">
          <span className="w-20 shrink-0 text-[14px] font-semibold">{t(LIFT_LABEL[lift])}</span>
          <span className="grid flex-1 grid-cols-3 gap-1.5">
            {ATTEMPT_ROWS.filter((r) => r.lift === lift).map((spot) => {
              const a = find(spot);
              const on = focus?.lift === spot.lift && focus.number === spot.number;
              const tone = a?.result === "GOOD" ? "bg-ok/15 text-ok" : a?.result === "MISS" ? "bg-miss/15 text-miss line-through" : "bg-background text-foreground";
              return (
                <button
                  key={spot.number}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(spot)}
                  className={`h-9 rounded-lg border text-[14px] font-semibold tabular-nums ${tone} ${on ? "border-accent" : "border-transparent"}`}
                >
                  {a?.weight ?? "—"}
                </button>
              );
            })}
          </span>
        </div>
      ))}
      {error && <p className="text-[13px] text-miss">{error}</p>}
    </div>
  );
}
