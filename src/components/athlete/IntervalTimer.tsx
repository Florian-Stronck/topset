"use client";

import { useEffect, useRef, useState } from "react";
import { beep, openAudio } from "@/components/athlete/beep";
import { formatDuration, parseDuration } from "@/lib/duration";
import { t } from "@/lib/i18n";

type Phase = "work" | "rest";
type WakeLock = { release: () => Promise<void> };

/**
 * A gym clock for rounds that aren't in the plan: so many rounds of work and rest, a
 * high beep to go and a low one to stop, with ten seconds' warning. Keeps the screen on
 * while it runs.
 */
export function IntervalTimer() {
  const [rounds, setRounds] = useState(5);
  const [work, setWork] = useState(180);
  const [rest, setRest] = useState(60);
  const [state, setState] = useState<{ round: number; phase: Phase; left: number } | null>(null);
  const [running, setRunning] = useState(false);
  const endAt = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const wake = useRef<WakeLock | null>(null);
  const warned = useRef(false);

  function release() {
    void wake.current?.release().catch(() => {});
    wake.current = null;
  }

  useEffect(() => {
    if (!running || !state) return;
    const id = setInterval(() => {
      const ms = endAt.current - Date.now();
      if (ms > 0) {
        const left = Math.ceil(ms / 1000);
        if (left <= 10 && !warned.current) {
          warned.current = true;
          beep(audio.current, 660, 0.15);
        }
        setState((s) => (s ? { ...s, left } : s));
        return;
      }
      warned.current = false;
      // Work ends in rest, rest in the next round; the last round's work ends it all.
      if (state.phase === "work" && state.round >= rounds) {
        beep(audio.current, 440, 1.2);
        navigator.vibrate?.([400, 150, 400, 150, 400]);
        setRunning(false);
        setState(null);
        release();
        return;
      }
      const next: { round: number; phase: Phase; left: number } =
        state.phase === "work" && rest > 0
          ? { round: state.round, phase: "rest", left: rest }
          : { round: state.round + 1, phase: "work", left: work };
      beep(audio.current, next.phase === "work" ? 880 : 440, 0.8);
      navigator.vibrate?.(next.phase === "work" ? [300] : [300, 120, 300]);
      endAt.current = Date.now() + next.left * 1000;
      setState(next);
    }, 250);
    return () => clearInterval(id);
  }, [running, state, rounds, work, rest]);

  useEffect(() => release, []);

  function start() {
    audio.current = openAudio(audio.current);
    const lock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } }).wakeLock;
    lock
      ?.request("screen")
      .then((w) => {
        wake.current = w;
      })
      .catch(() => {});
    const from = state ?? { round: 1, phase: "work" as const, left: work };
    if (!state) beep(audio.current, 880, 0.8);
    endAt.current = Date.now() + from.left * 1000;
    setState(from);
    setRunning(true);
  }

  function pause() {
    setRunning(false);
    release();
  }

  const button = "h-12 flex-1 rounded-xl text-[15px] font-medium";
  return (
    <section className="rounded-2xl border border-border bg-surface px-4 py-4">
      <h2 className="text-[15px] font-semibold">{t("Round timer")}</h2>

      {state ? (
        <div className="mt-3 text-center">
          <div className={`text-[12px] font-semibold tracking-[0.16em] ${state.phase === "work" ? "text-accent" : "text-ok"}`}>
            {state.phase === "work" ? t("ROUND {n} OF {of}", { n: state.round, of: rounds }) : t("REST")}
          </div>
          <div className={`mt-1 text-[64px] font-semibold leading-none tabular-nums ${state.left <= 10 && state.phase === "work" ? "text-accent" : ""}`}>
            {formatDuration(state.left)}
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Field label={t("ROUNDS")} value={String(rounds)} onCommit={(v) => {
            const n = Math.round(Number(v));
            if (Number.isFinite(n) && n >= 1 && n <= 50) setRounds(n);
          }} />
          <Field label={t("WORK")} value={formatDuration(work)} onCommit={(v) => {
            const s = parseDuration(v);
            if (s) setWork(s);
          }} />
          <Field label={t("REST")} value={formatDuration(rest)} onCommit={(v) => {
            const s = v.trim() === "0" ? 0 : parseDuration(v);
            if (s !== null) setRest(s);
          }} />
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={running ? pause : start} className={`${button} bg-accent text-white`}>
          {running ? t("Pause") : state ? t("Resume") : t("Start")}
        </button>
        {state && !running && (
          <button type="button" onClick={() => setState(null)} className={`${button} border border-border text-muted`}>
            {t("Reset")}
          </button>
        )}
      </div>
    </section>
  );
}

function Field({ label, value, onCommit }: { label: string; value: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block">
      <span className="text-[11px] tracking-[0.14em] text-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (draft !== null) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="mt-1 h-12 w-full rounded-xl border border-border bg-surface-2 px-3 text-center text-[18px] tabular-nums outline-none focus:border-accent"
      />
    </label>
  );
}
