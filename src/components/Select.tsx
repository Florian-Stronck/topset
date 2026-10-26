"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "@/components/Popover";

export type SelectOption<V> = { value: V; label: ReactNode; group?: string };

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 opacity-70">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Arrow keys walk the items, like the OS list did. */
function walk(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0);
  items[next]?.focus();
}

/** The app's one list of choices, with a check on the current one. Goes inside a Popover. */
export function MenuOptions<V>({
  value,
  options,
  onPick,
  className = "-m-2",
  autoFocus = true,
}: {
  value: V;
  options: SelectOption<V>[];
  onPick: (value: V) => void;
  className?: string;
  /** Off in the grid, whose keyboard moves stay with the cell. */
  autoFocus?: boolean;
}) {
  return (
    <div
      role="menu"
      onKeyDown={walk}
      // Lands on the current choice when it opens, so arrows and Enter work straight away.
      ref={(el) => {
        if (autoFocus && el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
      }}
      className={className}
    >
      {options.map((o, i) => {
        const on = Object.is(o.value, value);
        return (
          <div key={String(o.value)}>
            {o.group && o.group !== options[i - 1]?.group && (
              <div className={`px-2 pb-0.5 text-[10px] tracking-[0.12em] text-muted-2 ${i > 0 ? "mt-1.5 border-t border-border pt-1.5" : "pt-0.5"}`}>{o.group}</div>
            )}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={on}
              onClick={() => onPick(o.value)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                on ? "bg-surface-3 text-foreground" : "text-muted hover:bg-surface-3 hover:text-foreground focus:bg-surface-3 focus:text-foreground"
              }`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{o.label}</span>
              {on && <Check />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The app's dropdown, used in place of the OS select everywhere: the native list renders
 * white with greyed-out options in the desktop app. `className` styles the button like the
 * field around it.
 */
export function Select<V extends string | number>({
  value,
  options,
  onChange,
  className = "",
  placeholder,
  title,
  disabled,
  minWidth = 160,
  "aria-label": ariaLabel,
}: {
  value: V;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  className?: string;
  /** Shown when no option has the value. */
  placeholder?: ReactNode;
  title?: string;
  disabled?: boolean;
  minWidth?: number;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(minWidth);
  const current = options.find((o) => o.value === value);
  const close = () => {
    setOpen(false);
    ref.current?.focus({ preventScroll: true });
  };
  const show = () => {
    setWidth(Math.max(minWidth, ref.current?.offsetWidth ?? 0));
    setOpen(true);
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
        className={`flex cursor-pointer items-center justify-between gap-1.5 text-left disabled:cursor-default disabled:opacity-60 ${className}`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">{current?.label ?? placeholder ?? ariaLabel}</span>
        <Chevron />
      </button>
      <Popover open={open} onClose={close} anchorRef={ref} width={width}>
        <MenuOptions
          value={value}
          options={options}
          onPick={(v) => {
            close();
            if (v !== value) onChange(v);
          }}
        />
      </Popover>
    </>
  );
}
