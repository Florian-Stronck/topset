"use client";

import { usePathname } from "next/navigation";
import { SwipeDays } from "@/components/athlete/SwipeDays";

/** The bottom bar's places, left to right. */
const SECTIONS = ["/a/coach", "/a/coach/athletes", "/a/coach/chats", "/a/coach/meets"];

/** An athlete's pages, in the order their tabs show. */
const PAGES = ["", "/training", "/body", "/schedule", "/meet"];

/**
 * Swiping sideways turns to the neighbouring page, as the tabs line them up: the bottom
 * bar's places on its pages, an athlete's pages on theirs. Anything that scrolls or drags
 * sideways itself (week tiles, fields, chip rows) keeps the swipe, as in the athlete app.
 */
export function Swipe({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  let list: string[] | null = null;
  if (SECTIONS.includes(path)) list = SECTIONS;
  else {
    const athlete = /^\/a\/coach\/([^/]+)/.exec(path)?.[1];
    if (athlete) list = PAGES.map((p) => `/a/coach/${athlete}${p}`);
  }
  const at = list?.indexOf(path) ?? -1;
  if (!list || at < 0) return children;
  return (
    <SwipeDays prev={list[at - 1] ?? null} next={list[at + 1] ?? null}>
      {children}
    </SwipeDays>
  );
}
