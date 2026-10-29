"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type Anchor = { top: number; left: number; maxHeight: number };

const noop = () => () => {};

/** Open popovers, newest last: Escape closes only the top one, not the one it was opened from. */
const stack: object[] = [];

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
  // False on the server and while hydrating, true after: a popover open from the first
  // render (a link that opens one) must not appear before the page it belongs to.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const panelRef = useRef<HTMLDivElement>(null);
  // A popover opened from inside this one is portalled outside its DOM, but React events
  // still bubble up the component tree: a press in it marks this one, which then stays open.
  const pressedInside = useRef(false);
  // Closed with the focus inside, the focus goes back to what opened it, not to the page.
  const hadFocus = useRef(false);
  useEffect(() => {
    if (!open) return;
    // Read off the document: a list that takes the focus as it mounts does so before React's onFocus.
    const inside = () => {
      if (panelRef.current?.contains(document.activeElement)) hadFocus.current = true;
    };
    inside();
    document.addEventListener("focusin", inside);
    const anchor = anchorRef;
    return () => {
      document.removeEventListener("focusin", inside);
      const lost = !document.activeElement || document.activeElement === document.body;
      if (hadFocus.current && lost) anchor.current?.focus({ preventScroll: true });
      hadFocus.current = false;
    };
  }, [open, anchorRef]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;

    function place() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Its full height, even while capped; too tall for the window, it scrolls inside.
      const natural = panelRef.current?.scrollHeight ?? 260;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      // Below if it fits, else above if it fits there, else whichever side has more room.
      const down = natural <= below || (natural > above && below >= above);
      // Capped by the room on its side, not its height now, so content added later still shows.
      const maxHeight = down ? below : above;
      const top = down ? rect.bottom + 4 : rect.top - Math.min(natural, above) - 4;
      const rawLeft = align === "right" ? rect.right - width : rect.left;
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));

      setPos({ top, left, maxHeight });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, width, align, hydrated]);

  // Its own effect: the one below re-runs whenever a caller passes a fresh onClose.
  const [me] = useState(() => ({}));
  useEffect(() => {
    if (!open) return;
    stack.push(me);
    return () => void stack.splice(stack.indexOf(me), 1);
  }, [open, me]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      const nested = pressedInside.current;
      pressedInside.current = false;
      if (nested || panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && stack.at(-1) === me) onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef, me]);

  if (!open || !hydrated) return null;

  return createPortal(
    <div
      ref={panelRef}
      data-popover=""
      onMouseDown={() => {
        pressedInside.current = true;
      }}
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxHeight: pos?.maxHeight }}
      className="z-[100] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface-2 p-3 shadow-xl shadow-black/60"
    >
      {children}
    </div>,
    document.body,
  );
}
