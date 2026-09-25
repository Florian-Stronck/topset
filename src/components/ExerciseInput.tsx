"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { inputBase, useSelectOnFocus } from "@/components/cells";
import { completionFor, suggestExercises } from "@/lib/exercises";
import { t } from "@/lib/i18n";

/**
 * The EXERCISE cell: a text input with a suggestion list and a greyed inline
 * completion (Tab accepts). `picked` tells the caller the name came from the list
 * rather than free text, which is when the TARGET and tier are worth deriving.
 */
export function ExerciseInput({
  value,
  history,
  onCommit,
  placeholder,
  className = "",
}: {
  value: string | null;
  history: string[];
  onCommit: (name: string | null, picked: boolean) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /**
   * Tab walks the list. The query it filters on is the text that was typed, kept here
   * while the input itself shows whichever suggestion is being tried — otherwise the
   * first Tab would narrow the list to the one name it had just written.
   */
  const [cycling, setCycling] = useState<{ query: string; index: number } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const dirty = useRef(false);
  /** Set by Escape: the blur it causes must not save the text it just threw away. */
  const discard = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const select = useSelectOnFocus();

  useEffect(() => {
    if (!dirty.current) setDraft(value ?? "");
  }, [value]);

  // The list opens on typing, never on focus alone: a focused cell has to leave the
  // arrow keys to the grid, or a coach can no longer walk down a column.
  const options = open ? suggestExercises(cycling?.query ?? draft, history) : [];
  const completion =
    open && active < 0 && cycling === null ? completionFor(draft, history) : "";

  useLayoutEffect(() => {
    if (open) setRect(inputRef.current?.getBoundingClientRect() ?? null);
  }, [open, draft]);

  function close() {
    setOpen(false);
    setActive(-1);
    setCycling(null);
  }

  function commit(next: string, picked: boolean) {
    dirty.current = false;
    setDraft(next);
    close();
    const out = next.trim() === "" ? null : next.trim();
    if (picked || out !== value) onCommit(out, picked);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Only the open list swallows the arrows; otherwise they walk the grid.
      if (!open || options.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        const next = i + step;
        if (next < 0) return options.length - 1;
        return next >= options.length ? 0 : next;
      });
      return;
    }

    if (e.key === "Tab" && options.length > 0) {
      // Ours while there are suggestions — the grid would otherwise take Tab to move on.
      e.preventDefault();
      e.stopPropagation();
      const query = cycling?.query ?? draft;
      const list = suggestExercises(query, history);
      if (list.length === 0) return;

      const step = e.shiftKey ? -1 : 1;
      const index =
        cycling === null
          ? e.shiftKey
            ? list.length - 1
            : 0
          : (cycling.index + step + list.length) % list.length;

      // Cycling is browsing, not typing: nothing is saved until one is taken.
      dirty.current = true;
      setCycling({ query, index });
      setActive(index);
      setDraft(list[index]);
      return;
    }

    if (e.key === "Enter") {
      // Enter only picks when the highlight was moved on purpose; otherwise it
      // commits what was typed and lets the grid move down, like every other cell.
      if (open && active >= 0 && options[active]) {
        e.preventDefault();
        e.stopPropagation();
        commit(options[active], true);
        inputRef.current?.blur();
        return;
      }
      e.currentTarget.blur();
      return;
    }

    if (e.key === "Escape") {
      // Backing out of a cycle puts what was typed back before closing anything.
      if (cycling !== null) {
        e.stopPropagation();
        setDraft(cycling.query);
        close();
        return;
      }
      if (open && options.length > 0) {
        e.stopPropagation();
        close();
        return;
      }
      dirty.current = false;
      discard.current = true;
      setDraft(value ?? "");
      e.currentTarget.blur();
    }
  }

  return (
    <div className="relative h-full w-full">
      <input
        {...select}
        ref={inputRef}
        value={draft}
        placeholder={placeholder ?? t("add exercise")}
        onChange={(e) => {
          const typed = e.target.value;
          dirty.current = true;
          setDraft(typed);
          setActive(-1);
          setCycling(null);
          setOpen(true);
          // No saving mid-word here, unlike the other cells: a half-typed name would
          // become a suggestion of its own and fill in the wrong tier and target. The
          // name is saved when it is taken — Enter, a click, or leaving the cell.
        }}
        // A name reached with Tab counts as picked from the list, like a click would.
        onBlur={() => {
          if (discard.current) {
            discard.current = false;
            close();
            return;
          }
          commit(draft, cycling !== null);
        }}
        onKeyDown={onKeyDown}
        className={`${inputBase} truncate ${className}`}
      />

      {completion && (
        <div
          aria-hidden
          className={`${inputBase} pointer-events-none absolute inset-0 z-20 flex items-center truncate ${className}`}
        >
          <span className="invisible">{draft}</span>
          <span className="text-muted-2">{completion}</span>
        </div>
      )}

      {open && options.length > 0 && rect
        ? createPortal(
            <ul
              className="z-50 max-h-[240px] overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
              style={{
                position: "fixed",
                left: rect.left,
                top: rect.bottom + 2,
                width: Math.max(rect.width, 200),
              }}
            >
              {options.map((name, i) => (
                <li key={name}>
                  <button
                    type="button"
                    // Mousedown would blur the input first and close the list.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      commit(name, true);
                      inputRef.current?.blur();
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`block w-full truncate px-2.5 py-1 text-left text-[12px] ${
                      i === active ? "bg-surface-3 text-foreground" : "text-muted"
                    }`}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
