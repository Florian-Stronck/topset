"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** How far a finger has to travel sideways before it counts as a swipe, in px. */
const SWIPE = 70;

/**
 * Swiping the day sideways steps through days: left for the next one, right for the one
 * before, like turning pages. A swipe that starts on something that takes a drag of its
 * own — a field, a scale, anything that scrolls sideways — is left to it, and so is a
 * mostly vertical one, which is the page scrolling.
 */
export function SwipeDays({ prev, next, children }: { prev: string; next: string; children: React.ReactNode }) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);

  useEffect(() => {
    router.prefetch(prev);
    router.prefetch(next);
  }, [router, prev, next]);

  function ownDrag(target: EventTarget | null): boolean {
    for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
      if (el.matches("input, textarea, select, [role=slider], [data-no-swipe]")) return true;
      if (el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== "visible") return true;
    }
    return false;
  }

  return (
    <div
      onTouchStart={(e) => {
        const t = e.touches[0];
        start.current = e.touches.length === 1 && !ownDrag(e.target) ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchMove={(e) => {
        if (!start.current) return;
        const t = e.touches[0];
        const x = t.clientX - start.current.x;
        const y = t.clientY - start.current.y;
        // Once it is clearly a scroll, let it go.
        if (Math.abs(y) > Math.abs(x) && Math.abs(y) > 10) {
          start.current = null;
          setDx(0);
          return;
        }
        setDx(x);
      }}
      onTouchEnd={() => {
        if (start.current && Math.abs(dx) > SWIPE) router.push(dx < 0 ? next : prev);
        start.current = null;
        setDx(0);
      }}
      onTouchCancel={() => {
        start.current = null;
        setDx(0);
      }}
      style={{ transform: dx ? `translateX(${dx * 0.25}px)` : undefined, transition: dx ? "none" : "transform 150ms ease-out" }}
    >
      {children}
    </div>
  );
}
