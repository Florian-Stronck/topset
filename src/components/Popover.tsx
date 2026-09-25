"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Anchor = { top: number; left: number };

// Position before paint on the client; fall back to useEffect during SSR.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Renders into document.body: the grid's sticky cells each create their own
 * stacking context, so a popover nested inside one is painted under the rows
 * that follow it no matter how high its z-index is.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  width,
  children,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  width: number;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const [pos, setPos] = useState<Anchor | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;

    function place() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const height = panelRef.current?.offsetHeight ?? 260;

      const below = window.innerHeight - rect.bottom;
      const top = below < height + 12 && rect.top > height ? rect.top - height - 4 : rect.bottom + 4;
      const rawLeft = align === "right" ? rect.right - width : rect.left;
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));

      setPos({ top, left });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, width, align]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      className="z-[100] rounded-lg border border-border bg-surface-2 p-3 shadow-xl shadow-black/60"
    >
      {children}
    </div>,
    document.body,
  );
}
