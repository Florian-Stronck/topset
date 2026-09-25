"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useKeyRecorder } from "@/components/useKeyRecorder";
import type { Command } from "@/lib/commands";
import { setPref, usePref } from "@/lib/prefs";
import { bindKey, clashes, COMMAND_SPECS, keysOf, label, SPEC_BY_ID } from "@/lib/shortcuts";
import { t } from "@/lib/i18n";

export type { Command } from "@/lib/commands";

const GROUPS = [...new Set(COMMAND_SPECS.map((s) => s.group))];

/** Groups in the order the built-in commands list them; anything else after. */
function groupRank(group: string) {
  const at = GROUPS.indexOf(group);
  return at === -1 ? GROUPS.length : at;
}

type Mode = { prefix: string; title: string; placeholder: string; keep: (c: Command) => boolean };

/** Like an editor's quick open: a first character narrows the palette to one kind of thing. */
export const MODES: Mode[] = [
  { prefix: ">", title: "Actions only", placeholder: "Type an action…", keep: (c) => !c.kind },
  { prefix: "@", title: "Go to an athlete", placeholder: "Type an athlete's name…", keep: (c) => c.kind === "athlete" },
  { prefix: "#", title: "Go to a page, program, phase or meet", placeholder: "Type where to go…", keep: (c) => c.kind === "place" },
  { prefix: ":", title: "Go to a week", placeholder: "Type a week number…", keep: (c) => c.kind === "week" },
  { prefix: "?", title: "What the prefixes do", placeholder: "Pick a prefix…", keep: () => false },
];

function modeOf(query: string): { mode: Mode | null; rest: string } {
  const mode = MODES.find((m) => query.startsWith(m.prefix)) ?? null;
  return { mode, rest: mode ? query.slice(mode.prefix.length) : query };
}

type Match = { command: Command; score: number; hits: number[]; section: string };

/** The positions of `q`'s characters in `text`, in order, preferring the starts of words. */
function subsequence(text: string, q: string): number[] | null {
  const hits: number[] = [];
  let from = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    // A word start further on beats the first loose hit, so "aw" lands on "Add a Week".
    let at = -1;
    for (let i = from; i < text.length; i++) {
      if (text[i] !== ch) continue;
      if (at === -1) at = i;
      if (i === 0 || /[\s\-(/·]/.test(text[i - 1])) {
        at = i;
        break;
      }
    }
    if (at === -1) return null;
    hits.push(at);
    from = at + 1;
  }
  return hits;
}

function score(command: Command, query: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase().trim();
  const title = command.title.toLowerCase();
  const at = title.indexOf(q);
  if (at === 0) return { score: 1000 - title.length, hits: [...Array(q.length).keys()] };
  if (at > 0) return { score: 800 - at, hits: [...Array(q.length).keys()].map((i) => i + at) };

  const loose = subsequence(title, q.replace(/\s+/g, ""));
  if (loose) {
    const spread = loose[loose.length - 1] - loose[0];
    return { score: 600 - spread, hits: loose };
  }
  // The group and keywords count too, without anything to underline.
  const rest = `${t(command.group)} ${command.group} ${command.keywords ?? ""} ${SPEC_BY_ID.get(command.id)?.title ?? ""}`.toLowerCase();
  if (q.split(/\s+/).every((word) => rest.includes(word) || title.includes(word))) return { score: 300, hits: [] };
  if (subsequence(`${rest} ${title}`, q.replace(/\s+/g, ""))) return { score: 100, hits: [] };
  return null;
}

function Highlighted({ text, hits }: { text: string; hits: number[] }) {
  if (hits.length === 0) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-accent">
            {ch}
          </span>
        ) : (
          <Fragment key={i}>{ch}</Fragment>
        ),
      )}
    </>
  );
}

export function CommandPalette({
  open,
  onClose,
  onRun,
  commands,
  inGrid,
  initialQuery = "",
}: {
  open: boolean;
  /** Where the query starts — a prefix, when opened straight into one of the modes. */
  initialQuery?: string;
  onClose: () => void;
  onRun: (command: Command) => void;
  commands: Command[];
  /** A grid row had focus when the palette opened, so the row commands mean something. */
  inGrid: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const rawQuery = query;
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorder = useKeyRecorder();

  // Every opening starts from a blank query, reset during the render that opens it.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQuery(initialQuery);
      setActive(0);
    }
  }

  const pinned = usePref("pinnedCommands");
  const recent = usePref("recentCommands");
  // Read so the key chips redraw when a binding changes.
  const overrides = usePref("keybindings");

  const { mode, rest } = modeOf(query);

  const matches = useMemo<Match[]>(() => {
    const { mode, rest: query } = modeOf(rawQuery);
    if (mode?.prefix === "?") {
      // The prefixes themselves, each picking its mode instead of running anything.
      return MODES.filter((m) => m.prefix !== "?").map((m) => ({
        command: { id: `mode:${m.prefix}`, group: "Help", title: `${m.prefix}  ${t(m.title)}`, run: () => {} },
        score: 0,
        hits: [],
        section: t("Prefixes"),
      }));
    }
    const usable = commands.filter(
      (c) => !c.hidden && (c.when !== "grid" || inGrid) && (!mode || mode.keep(c)),
    );
    if (mode && query.trim() === "") {
      // A mode lists everything of its kind, the screen's own groups first.
      return [...usable]
        .sort((a, b) => groupRank(a.group) - groupRank(b.group))
        .map((command) => ({ command, score: 0, hits: [], section: t(mode.title) }));
    }
    if (query.trim() === "") {
      const byId = new Map(usable.map((c) => [c.id, c]));
      const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((c): c is Command => Boolean(c));
      // The coach's pinned commands lead, in the order they were pinned; then what was
      // run lately; then everything, group by group.
      const top = pick(pinned);
      const lately = pick(recent.filter((id) => !pinned.includes(id))).slice(0, 5);
      const shown = new Set([...top, ...lately].map((c) => c.id));
      return [
        ...top.map((command) => ({ command, score: 0, hits: [], section: t("Pinned") })),
        ...lately.map((command) => ({ command, score: 0, hits: [], section: t("Recently used") })),
        ...usable
          .filter((c) => !shown.has(c.id))
          // Several parts of the page register the same group; keep each under one heading.
          .sort((a, b) => groupRank(a.group) - groupRank(b.group))
          .map((command) => ({ command, score: 0, hits: [], section: t(command.group) })),
      ];
    }
    return usable
      .flatMap((command) => {
        const s = score(command, query);
        if (!s) return [];
        // Something used lately edges ahead of an equal match.
        const bonus = recent.includes(command.id) ? 40 - recent.indexOf(command.id) : 0;
        return [{ command, score: s.score + bonus, hits: s.hits, section: "" }];
      })
      .sort((a, b) => b.score - a.score);
  }, [commands, rawQuery, pinned, recent, inGrid]);

  const current = matches[Math.min(active, matches.length - 1)];

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, matches]);

  if (!open || typeof document === "undefined") return null;

  const run = (command: Command) => {
    if (command.id.startsWith("mode:")) {
      setQuery(command.id.slice(5));
      setActive(0);
      inputRef.current?.focus();
      return;
    }
    setPref("recentCommands", [command.id, ...recent.filter((id) => id !== command.id)].slice(0, 12));
    onRun(command);
  };

  const record = (command: Command) =>
    !command.id.startsWith("mode:") &&
    recorder.start(command.id, (keys) => {
      bindKey(command.id, keys, command.title);
      inputRef.current?.focus();
    });

  const recording = recorder.target ? commands.find((c) => c.id === recorder.target) : undefined;

  return createPortal(
    <div
      data-overlay
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(600px,92vw)] overflow-hidden rounded-xl border border-border bg-surface-2 shadow-2xl shadow-black/60">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          placeholder={mode ? t(mode.placeholder) : t("Type a command, or ? for prefixes…")}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
            if (step !== undefined) {
              e.preventDefault();
              setActive((i) => {
                const next = i + step;
                if (Math.abs(step) === 1) {
                  if (next < 0) return matches.length - 1;
                  return next >= matches.length ? 0 : next;
                }
                return Math.min(matches.length - 1, Math.max(0, next));
              });
              return;
            }
            if ((e.key === "Home" || e.key === "End") && e.ctrlKey) {
              e.preventDefault();
              setActive(e.key === "Home" ? 0 : matches.length - 1);
              return;
            }
            if (e.key === "Enter" && current) {
              e.preventDefault();
              // Alt+Enter sets the command's key instead of running it.
              if (e.altKey) record(current.command);
              else run(current.command);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              // Esc in a mode goes back to every command first.
              if (mode && rest === "" && initialQuery === "") setQuery("");
              else onClose();
            }
          }}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-[14px] outline-none placeholder:text-muted-2"
        />

        {recording && (
          <div className="border-b border-border bg-surface-3 px-4 py-2 text-[12px] text-accent">
            {recorder.strokes.length > 0
              ? t("{keys} — a second key makes a chord, Enter saves", { keys: label(recorder.strokes.join(" ")) })
              : t("Press the keys for “{name}”. Esc cancels.", { name: recording.title })}
          </div>
        )}

        <div ref={listRef} className="max-h-[360px] overflow-auto py-1.5">
          {matches.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-muted-2">{t("Nothing matches.")}</div>
          )}

          {matches.map(({ command, hits, section }, i) => {
            const isActive = command === current?.command;
            const newSection = section !== "" && (i === 0 || matches[i - 1].section !== section);
            const keys = keysOf(command.id, overrides);
            // A prefix in the ? list is not a command: nothing to bind or pin.
            const meta = command.id.startsWith("mode:") ? "hidden" : "";
            const isPinned = pinned.includes(command.id);
            const clash = keys[0] ? clashes(command.id, keys[0], overrides).length > 0 : false;
            return (
              <div key={`${section}:${command.id}`}>
                {newSection && (
                  <div className="px-4 pt-2 pb-1 text-[10px] tracking-[0.16em] text-muted-2">{section.toUpperCase()}</div>
                )}
                <button
                  type="button"
                  data-active={isActive}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => {
                    if (!isActive) setActive(i);
                  }}
                  onClick={() => run(command)}
                  className={`group/cmd flex w-full items-center gap-2 px-4 py-1.5 text-left text-[13px] ${
                    isActive ? "bg-surface-3 text-foreground" : "text-muted"
                  }`}
                >
                  {section === "" && <span className="shrink-0 text-muted-2">{t(command.group)}:</span>}
                  <span className="truncate">
                    <Highlighted text={command.title} hits={hits} />
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {keys.slice(0, 2).map((k) => (
                      <span
                        key={k}
                        title={clash ? t("Also used by another shortcut.") : undefined}
                        className={`rounded border px-1.5 py-0.5 text-[11px] ${
                          clash ? "border-warn text-warn" : "border-border text-muted-2"
                        }`}
                      >
                        {label(k)}
                      </span>
                    ))}
                    <span
                      role="button"
                      tabIndex={-1}
                      title={t("Set a keyboard shortcut (Alt+Enter)")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        record(command);
                      }}
                      className={`${meta} px-1 text-[12px] text-muted-2 hover:text-accent ${
                        isActive ? "opacity-100" : "opacity-0 group-hover/cmd:opacity-100"
                      }`}
                    >
                      ⌨
                    </span>
                    <span
                      role="button"
                      tabIndex={-1}
                      title={isPinned ? t("Unpin") : t("Pin to the top")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPref("pinnedCommands", isPinned ? pinned.filter((id) => id !== command.id) : [...pinned, command.id]);
                      }}
                      className={`${meta} px-1 text-[12px] ${
                        isPinned ? "text-accent" : "text-muted-2 opacity-0 hover:text-accent group-hover/cmd:opacity-100"
                      }`}
                    >
                      {isPinned ? "★" : "☆"}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-1.5 text-[10px] text-muted-2">
          <span>↑↓ {t("move")}</span>
          <span>Enter {t("run")}</span>
          <span>{label("alt+enter")} {t("set its shortcut")}</span>
          <span>☆ {t("pin")}</span>
          <span>? {t("prefixes")}</span>
          <span className="ml-auto">
            {mode && <span className="mr-2 text-accent">{t(mode.title)}</span>}
            {t("{n} commands", { n: matches.length })}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
