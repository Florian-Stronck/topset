"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { inputBase, titleWhenCut, useSelectOnFocus } from "@/components/cells";
import { completionFor, suggestExercises } from "@/lib/exercises";
import { t } from "@/lib/i18n";

/**
 * The EXERCISE cell: a text input with a suggestion list and a greyed inline
 * completion. Enter and Tab take the completion — or the suggestion the arrows moved to —
 * and move on, as a sheet's autocomplete does. `picked` tells the caller the name came
 * from the list rather than free text, which is when the TARGET and tier are worth deriving.
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
  const [rect, setRect] = useState<DOMRect | null>(null);
  const dirty = useRef(false);
  /** Set when a name is taken: the blur that follows must not save the half-typed text over it. */
  const discard = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const select = useSelectOnFocus();

  useEffect(() => {
    if (!dirty.current) setDraft(value ?? "");
  }, [value]);

  // The list opens on typing, never on focus alone: a focused cell has to leave the
  // arrow keys to the grid, or a coach can no longer walk down a column.
  const options = open ? suggestExercises(draft, history, 8) : [];
  const completion = open && active < 0 ? completionFor(draft, history) : "";

  useLayoutEffect(() => {
    if (!open) return;
    // Kept on the cell while the grid scrolls under it.
    const place = () => setRect(inputRef.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, draft]);

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function commit(next: string, picked: boolean) {
    dirty.current = false;
    setDraft(next);
    close();
    const out = next.trim() === "" ? null : next.trim();
    if (picked || out !== value) onCommit(out, picked);
  }

  /** A name taken from the list or the completion, and the cell left. */
  function take(name: string) {
    commit(name, true);
    // The blur below still sees the half-typed draft; it must not save that over the pick.
    discard.current = true;
    inputRef.current?.blur();
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

    if ((e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // The suggestion the arrows moved to, else the greyed completion, else what was
      // typed. Not swallowed either way: the grid still moves down, or across.
      const name = open && active >= 0 ? options[active] : completion ? suggestExercises(draft, history, 1)[0] : undefined;
      if (name) take(name);
      else if (e.key === "Enter") e.currentTarget.blur();
      return;
    }

    if (e.key === "Escape") {
      if (open && options.length > 0) {
        e.stopPropagation();
        close();
        return;
      }
      // What was there comes back, and the cell stays selected for the arrow keys.
      dirty.current = false;
      setDraft(value ?? "");
      close();
      const input = e.currentTarget;
      delete input.dataset.editing;
      requestAnimationFrame(() => input.select());
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
          setOpen(true);
          // No saving mid-word here, unlike the other cells: a half-typed name would
          // become a suggestion of its own and fill in the wrong tier and target. The
          // name is saved when it is taken — Enter, a click, or leaving the cell.
        }}
        onMouseEnter={titleWhenCut}
        onBlur={() => {
          if (discard.current) {
            discard.current = false;
            close();
            return;
          }
          commit(draft, false);
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
          {/* Clicking the greyed rest takes it, like Tab or a click in the list. */}
          <span
            title={t("Click, Enter or Tab to take it")}
            // Mousedown would blur the input first and close the list.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => take(options[0])}
            className="pointer-events-auto cursor-pointer text-muted-2 hover:text-foreground"
          >
            {completion}
          </span>
        </div>
      )}

      {open && options.length > 0 && rect
        ? createPortal(
            <ul
              className="z-50 max-h-[240px] overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
              style={{
                position: "fixed",
                left: rect.left,
                width: Math.max(rect.width, 200),
                // Above the cell when there is no room for the list below it.
                ...(window.innerHeight - rect.bottom < 250 && rect.top > window.innerHeight - rect.bottom
                  ? { bottom: window.innerHeight - rect.top + 2 }
                  : { top: rect.bottom + 2 }),
              }}
            >
              {options.map((name, i) => (
                <li key={name}>
                  <button
                    type="button"
                    // Mousedown would blur the input first and close the list.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => take(name)}
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
