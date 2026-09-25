"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const inputBase =
  "h-full w-full rounded-[3px] bg-transparent px-2 py-1.5 text-[12px] outline-none placeholder:text-muted-2 focus:bg-surface-3 focus:ring-1 focus:ring-accent/60";

/** How long a cell sits still before it saves itself. */
export const COMMIT_DELAY = 500;

/**
 * Saves what was typed a moment after typing stops, so nothing has to be confirmed with
 * Enter. Leaving the cell — or the cell going away — flushes whatever is still pending,
 * which is what makes clicking a link mid-edit safe.
 */
export function useAutoCommit() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const run = pending.current;
    pending.current = null;
    run?.();
  }

  /** The save itself is the thing scheduled, so it carries the draft it was written for. */
  function schedule(run: () => void) {
    pending.current = run;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, COMMIT_DELAY);
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }

  useEffect(() => () => flush(), []);

  return { schedule, flush, cancel };
}

/**
 * Clicking a cell selects what is in it, so typing replaces rather than appends. Selecting
 * has to wait for mouseup, not fire on focus/mousedown — else the whole text is already
 * highlighted before a drag even starts, and there's nothing left to drag-select. A mouseup
 * that moved from mousedown is a drag: leave whatever range the browser already selected.
 */
export function useSelectOnFocus() {
  const downPos = useRef<{ x: number; y: number } | null>(null);

  return {
    onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => {
      downPos.current = { x: e.clientX, y: e.clientY };
    },
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      // Keyboard focus (Tab) has no preceding mousedown — select right away.
      if (!downPos.current) e.currentTarget.select();
    },
    onMouseUp: (e: React.MouseEvent<HTMLInputElement>) => {
      const start = downPos.current;
      downPos.current = null;
      if (!start) return;
      const moved = Math.abs(e.clientX - start.x) > 3 || Math.abs(e.clientY - start.y) > 3;
      if (moved) return;
      e.preventDefault();
      e.currentTarget.select();
    },
  };
}

/**
 * Enter anywhere in a popover form runs it; Escape closes it. Buttons keep their own
 * behaviour, so Enter on Cancel still cancels.
 */
export function formKeys(submit: () => void, cancel: () => void, disabled = false) {
  return (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;

    if (e.key === "Enter" && !disabled) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
}

export function NumberInput({
  value,
  onCommit,
  align = "center",
  placeholder = "—",
  className = "",
  autoFocus = false,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  align?: "center" | "right" | "left";
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const dirty = useRef(false);
  const auto = useAutoCommit();
  const select = useSelectOnFocus();

  // `autoFocus` alone lands the caret but not the selection — the browser focuses the
  // input before React attaches onFocus — so the first mount does both by hand.
  const focused = useRef(false);
  const initialFocus = useCallback(
    (el: HTMLInputElement | null) => {
      if (!el || !autoFocus || focused.current) return;
      focused.current = true;
      el.focus();
      el.select();
    },
    [autoFocus],
  );

  useEffect(() => {
    if (!dirty.current) setDraft(value === null ? "" : String(value));
  }, [value]);

  // A half-typed number ("-", "1.") is not an edit yet; it waits for the next keystroke.
  function save(text: string) {
    const trimmed = text.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && Number.isNaN(next)) return;
    if (next !== value) onCommit(next);
  }

  function commit() {
    // The blur path sends the same draft itself, so the pending one is dropped.
    auto.cancel();
    dirty.current = false;
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && Number.isNaN(next)) {
      setDraft(value === null ? "" : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  }

  const alignClass =
    align === "right" ? "text-right" : align === "left" ? "text-left" : "text-center";

  return (
    <input
      {...select}
      ref={initialFocus}
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        const typed = e.target.value;
        dirty.current = true;
        setDraft(typed);
        auto.schedule(() => save(typed));
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          auto.cancel();
          dirty.current = false;
          setDraft(value === null ? "" : String(value));
          e.currentTarget.blur();
        }
      }}
      className={`${inputBase} ${alignClass} ${className}`}
    />
  );
}

export function TextInput({
  value,
  onCommit,
  placeholder = "—",
  className = "",
  list,
  suggestions,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  placeholder?: string;
  className?: string;
  /** Id of a <datalist> to suggest from. */
  list?: string;
  /**
   * Finished as you type: the first one starting with what's typed fills in the rest,
   * selected, so Tab or Enter takes it and the next key typed replaces it.
   */
  suggestions?: readonly string[];
}) {
  const [draft, setDraft] = useState(value ?? "");
  const dirty = useRef(false);
  const auto = useAutoCommit();
  const select = useSelectOnFocus();
  const ref = useRef<HTMLInputElement>(null);
  const completion = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!dirty.current) setDraft(value ?? "");
  }, [value]);

  // The completed part is selected once React has put it in the field.
  useLayoutEffect(() => {
    if (completion.current && ref.current) ref.current.setSelectionRange(...completion.current);
    completion.current = null;
  });

  return (
    <input
      {...select}
      ref={ref}
      value={draft}
      placeholder={placeholder}
      list={list}
      onChange={(e) => {
        let typed = e.target.value;
        // Only while typing forward: deleting the suggestion must not bring it back.
        const inserting = (e.nativeEvent as InputEvent).inputType?.startsWith("insert");
        if (suggestions && inserting && typed.trim() !== "") {
          const lower = typed.toLowerCase();
          const hit = suggestions.find((s) => s.length > typed.length && s.toLowerCase().startsWith(lower));
          if (hit) {
            completion.current = [typed.length, hit.length];
            typed = hit;
          }
        }
        dirty.current = true;
        setDraft(typed);
        auto.schedule(() => {
          const next = typed.trim() === "" ? null : typed;
          if (next !== value) onCommit(next);
        });
      }}
      onBlur={() => {
        auto.cancel();
        dirty.current = false;
        const next = draft.trim() === "" ? null : draft;
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          auto.cancel();
          dirty.current = false;
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
      className={`${inputBase} truncate ${className}`}
    />
  );
}
