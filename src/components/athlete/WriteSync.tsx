"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The tabs keep their last render for a while (`staleTimes` in next.config), so a tap on a
 * tab answers at once. A write would leave the other tabs showing what it just changed, so
 * a moment after the last write the cache is dropped and the page on screen re-read.
 */
const IDLE_MS = 2000;

let onWrite: (() => void) | null = null;

/** An athlete action that writes: runs it, then schedules the refresh. */
export function synced<A extends unknown[], R>(action: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await action(...args);
    } finally {
      onWrite?.();
    }
  };
}

export function WriteSync() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    onWrite = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), IDLE_MS);
    };
    return () => {
      onWrite = null;
      clearTimeout(timer);
    };
  }, [router]);
  return null;
}
