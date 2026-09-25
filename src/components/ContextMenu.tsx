"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | {
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** A shortcut or extra detail, shown faded on the right. */
      hint?: string;
    }
  | "divider";

type Open = { x: number; y: number; items: MenuItem[] };

/**
 * A right-click menu. `open` goes on an element's onContextMenu with the items for it;
 * render `menu` anywhere in the component.
 */
export function useContextMenu() {
  const [state, setState] = useState<Open | null>(null);

  function open(e: React.MouseEvent, items: MenuItem[]) {
    const shown = items.filter((item, i) => item !== "divider" || (i > 0 && items[i - 1] !== "divider"));
    if (shown.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items: shown });
  }

  const menu = state ? <Menu {...state} onClose={() => setState(null)} /> : null;
  return { open, menu };
}

function Menu({ x, y, items, onClose }: Open & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);

  // Kept on screen: flipped left or up when it would run off the edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: x + width > window.innerWidth - 8 ? Math.max(8, x - width) : x,
      top: y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const choosable = items.map((item, i) => (item !== "divider" && !item.disabled ? i : -1)).filter((i) => i >= 0);
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => {
          const at = choosable.indexOf(a);
          const step = e.key === "ArrowDown" ? 1 : -1;
          return choosable[(at + step + choosable.length) % choosable.length] ?? -1;
        });
      } else if (e.key === "Enter") {
        const item = items[active];
        if (item && item !== "divider" && !item.disabled) {
          e.preventDefault();
          onClose();
          item.onSelect();
        }
      }
    }
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [items, active, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      className="z-[300] min-w-[200px] rounded-lg border border-border bg-surface-2 py-1 shadow-2xl shadow-black/60"
    >
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={i} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`flex w-full items-center gap-4 px-3 py-1.5 text-left text-[12px] disabled:opacity-40 ${
              i === active && !item.disabled ? "bg-surface-3" : ""
            } ${item.danger ? "text-accent" : "text-foreground"}`}
          >
            <span className="truncate">{item.label}</span>
            {item.hint && <span className="ml-auto shrink-0 text-[11px] text-muted-2">{item.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
