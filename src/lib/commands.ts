"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { When } from "@/lib/shortcuts";

/**
 * The commands on screen right now. Each part of the page registers its own — the
 * sidebar the places to go, the workspace the program's commands, the grid the row
 * ones — and the palette and the keyboard both read the merged list from here.
 */

export type Command = {
  id: string;
  title: string;
  group: string;
  /** Extra words the search should match, e.g. an athlete's other program names. */
  keywords?: string;
  /** Left out of the palette, but still reachable by its keys (undo with nothing to undo). */
  hidden?: boolean;
  when?: When;
  /**
   * What the command takes you to, for the palette's prefixes: `@` athletes, `#` places
   * (pages, programs, phases, meets), `:` weeks. Plain actions have none.
   */
  kind?: "athlete" | "place" | "week";
  run: () => void | Promise<unknown>;
};

type Source = { priority: number; commands: Command[] };

const sources = new Map<string, Source>();
const listeners = new Set<() => void>();
let snapshot: Command[] = [];

function rebuild() {
  // A higher priority wins an id both sources register — the workspace's "Tracking"
  // knows the phase, the sidebar's only the athlete.
  const byId = new Map<string, { command: Command; priority: number }>();
  for (const { priority, commands } of sources.values()) {
    for (const command of commands) {
      const had = byId.get(command.id);
      if (!had || had.priority <= priority) byId.set(command.id, { command, priority });
    }
  }
  snapshot = [...byId.values()].map((v) => v.command);
  for (const fn of listeners) fn();
}

export function registerCommands(source: string, commands: Command[], priority = 0) {
  sources.set(source, { priority, commands });
  rebuild();
  return () => {
    if (sources.get(source)?.commands === commands) {
      sources.delete(source);
      rebuild();
    }
  };
}

export function getCommands(): Command[] {
  return snapshot;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: Command[] = [];

export function useCommandList(): Command[] {
  return useSyncExternalStore(subscribe, getCommands, () => EMPTY);
}

/** Registers a part of the page's commands for as long as it is mounted. */
export function useCommands(source: string, commands: Command[], priority = 0) {
  useEffect(() => registerCommands(source, commands, priority), [source, commands, priority]);
}

// While the coach records a new key, the keyboard layer must not act on it.
let recording = 0;

export function setRecording(on: boolean) {
  recording = Math.max(0, recording + (on ? 1 : -1));
}

export function isRecording(): boolean {
  return recording > 0;
}

/** Runs a command by id, if it is on screen. */
export function runCommand(id: string): boolean {
  const command = snapshot.find((c) => c.id === id);
  if (!command) return false;
  void command.run();
  return true;
}

/** A link that opens a panel even when its page is already on screen with it closed. */
export function fresh(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}n=${Date.now()}`;
}
