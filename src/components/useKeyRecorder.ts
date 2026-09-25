"use client";

import { useEffect, useRef, useState } from "react";
import { setRecording } from "@/lib/commands";
import { hotkey, isModifierKey } from "@/lib/shortcuts";

/** How long a first stroke waits for a second before it is saved on its own. */
const CHORD_WAIT = 1200;

/**
 * Captures the next key, or two-stroke chord, the coach presses. Esc cancels, Enter
 * saves what has been pressed so far; a second stroke, or a pause, saves too.
 */
export function useKeyRecorder() {
  const [target, setTarget] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<string[]>([]);
  const done = useRef<((keys: string) => void) | null>(null);

  useEffect(() => {
    if (target === null) return;
    setRecording(true);
    let taken: string[] = [];
    let timer: number | undefined;

    const finish = (save: boolean) => {
      window.clearTimeout(timer);
      const keys = taken.join(" ");
      const cb = done.current;
      setTarget(null);
      setStrokes([]);
      if (save && keys && cb) cb(keys);
    };

    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (isModifierKey(e)) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      if (plain && e.key === "Escape") return finish(false);
      if (plain && e.key === "Enter" && taken.length > 0) return finish(true);

      taken = [...taken, hotkey(e)];
      setStrokes(taken);
      window.clearTimeout(timer);
      if (taken.length >= 2) return finish(true);
      timer = window.setTimeout(() => finish(true), CHORD_WAIT);
    }

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      setRecording(false);
    };
  }, [target]);

  return {
    /** Which thing is being recorded for, or null. */
    target,
    strokes,
    start(id: string, onDone: (keys: string) => void) {
      done.current = onDone;
      setStrokes([]);
      setTarget(id);
    },
    cancel() {
      setTarget(null);
      setStrokes([]);
    },
  };
}
