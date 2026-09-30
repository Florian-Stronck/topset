"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** This browser's IANA zone; null during the server render, so both renders agree. */
export function useTimeZone(): string | null {
  return useSyncExternalStore(
    noop,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    () => null,
  );
}
