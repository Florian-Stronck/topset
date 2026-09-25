"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { activeSettings } from "@/lib/settings";

export type HistoryEntry = {
  /** Shown on the undo button, so it says what it would take back. */
  label: string;
  undo: () => Promise<unknown> | unknown;
  redo: () => Promise<unknown> | unknown;
};

type History = {
  push: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  undoLabel: string | null;
  redoLabel: string | null;
};

const HistoryContext = createContext<History | null>(null);

const NOOP: History = {
  push: () => {},
  undo: () => {},
  redo: () => {},
  undoLabel: null,
  redoLabel: null,
};

export function useHistory(): History {
  return useContext(HistoryContext) ?? NOOP;
}


/**
 * An undo stack of inverse operations. Each entry knows how to take its edit back and
 * how to do it again; both run through the same server actions as the original, so the
 * grid never has to trust a locally reconstructed copy of the block.
 *
 * The stacks live in refs rather than state: an edit committed by the blur that undo
 * itself causes lands in the same tick, and a popped entry has to see it.
 *
 * `resetKey` clears them — entries name rows of one program, and they mean nothing once
 * a different one is open.
 */
export function HistoryProvider({
  resetKey,
  children,
}: {
  resetKey: string;
  children: React.ReactNode;
}) {
  const past = useRef<HistoryEntry[]>([]);
  const future = useRef<HistoryEntry[]>([]);
  const key = useRef(resetKey);
  // One at a time: two overlapping undos would race their revalidations.
  const running = useRef(false);

  const [labels, setLabels] = useState<{ undo: string | null; redo: string | null }>({
    undo: null,
    redo: null,
  });
  const [synced, setSynced] = useState(resetKey);

  if (synced !== resetKey) {
    setSynced(resetKey);
    setLabels({ undo: null, redo: null });
  }

  const publish = useCallback(() => {
    setLabels({
      undo: past.current.at(-1)?.label ?? null,
      redo: future.current.at(-1)?.label ?? null,
    });
  }, []);

  /** Stacks are dropped on the way into the first handler after the program changed. */
  const ensureKey = useCallback(() => {
    if (key.current === resetKey) return;
    key.current = resetKey;
    past.current = [];
    future.current = [];
  }, [resetKey]);

  const push = useCallback(
    (entry: HistoryEntry) => {
      ensureKey();
      // How far back undo reaches is the coach's call (Settings → Data).
      const limit = Math.max(1, activeSettings().undoLimit);
      past.current = [...past.current.slice(-(limit - 1)), entry];
      future.current = [];
      publish();
    },
    [ensureKey, publish],
  );

  const step = useCallback(
    (from: "past" | "future") => {
      ensureKey();

      // Leaving the cell first saves what is in it, so Ctrl+Z takes back the edit that
      // is actually on screen rather than the one before it.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

      const source = from === "past" ? past : future;
      const target = from === "past" ? future : past;

      if (running.current || source.current.length === 0) return;
      const entry = source.current[source.current.length - 1];

      source.current = source.current.slice(0, -1);
      target.current = [...target.current, entry];
      publish();

      running.current = true;
      void Promise.resolve(from === "past" ? entry.undo() : entry.redo()).finally(() => {
        running.current = false;
      });
    },
    [ensureKey, publish],
  );

  const value = useMemo<History>(
    () => ({
      push,
      undo: () => step("past"),
      redo: () => step("future"),
      undoLabel: labels.undo,
      redoLabel: labels.redo,
    }),
    [labels, push, step],
  );

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}
