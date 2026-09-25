"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutSheet } from "@/components/ShortcutSheet";
import { getCommands, isRecording, useCommandList, useCommands, type Command } from "@/lib/commands";
import { getPref, setPref, togglePref } from "@/lib/prefs";
import {
  allBindings,
  firesWhileTyping,
  hotkey,
  isModifierKey,
  label,
  matchStroke,
  migrateOldHotkeys,
} from "@/lib/shortcuts";
import { t } from "@/lib/i18n";

/** How long the first stroke of a chord waits for the second. */
const CHORD_WAIT = 1500;

// The chord under way, module-wide so the grid can tell a stroke is spoken for.
let pending: string | null = null;

function inGrid(el: Element | null): boolean {
  return Boolean(el?.closest("[data-nav], [data-row-head]"));
}

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** The bindings of the commands on screen that could run where the focus is. */
function liveBindings(commands: Command[]) {
  const here = new Set(
    commands.filter((c) => c.when !== "grid" || inGrid(document.activeElement)).map((c) => c.id),
  );
  return new Map([...allBindings()].filter(([id]) => here.has(id)));
}

/**
 * Whether the keyboard layer will act on this key — for handlers that run first (the
 * grid's arrows) and should leave it alone.
 */
export function claimsKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  if (isRecording() || isModifierKey(e)) return false;
  if (pending) return true;
  const stroke = hotkey(e);
  if (isEditable(document.activeElement) && !firesWhileTyping(stroke)) return false;
  const { run, chord } = matchStroke(liveBindings(getCommands()), stroke, null);
  return run.length > 0 || chord;
}

/**
 * The palette, the shortcut sheet and the keys, for every screen. Screens only
 * register commands; this decides which one a key press means.
 */
export function CommandCenter() {
  const router = useRouter();
  const pathname = usePathname();
  const commands = useCommandList();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [gridFocus, setGridFocus] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);

  // The athlete's phone app shares the layout, and has no use for any of this.
  const athleteApp = pathname.startsWith("/a/");

  useEffect(() => {
    // Keys used to be kept per default combo; bring them over once.
    const old = migrateOldHotkeys();
    if (old && Object.keys(old).length > 0) setPref("keybindings", { ...old, ...getPref("keybindings") });
  }, []);

  const core = useMemo<Command[]>(
    () => [
      {
        id: "palette",
        group: "General",
        title: t("Command palette"),
        hidden: true,
        run: () => openPalette(""),
      },
      {
        id: "quick-place",
        group: "General",
        title: t("Go to…"),
        keywords: "quick open jump page program phase meet #",
        run: () => openPalette("#"),
      },
      {
        id: "quick-athlete",
        group: "General",
        title: t("Go to athlete…"),
        keywords: "quick open switch @",
        run: () => openPalette("@"),
      },
      {
        id: "quick-week",
        group: "General",
        title: t("Go to week…"),
        keywords: "quick open jump :",
        run: () => openPalette(":"),
      },
      {
        id: "shortcuts",
        group: "Help",
        title: t("Keyboard shortcuts"),
        keywords: "keys hotkeys cheat sheet",
        run: () => {
          setPaletteOpen(false);
          setSheetOpen((o) => !o);
        },
      },
      {
        id: "keybindings",
        group: "General",
        title: t("Customise keyboard shortcuts…"),
        keywords: "keys hotkeys keybindings rebind preferences",
        run: () => router.push("/settings#keyboard"),
      },
      {
        id: "view-sidebar",
        group: "View",
        title: getPref("sidebarCollapsed") ? t("Expand the sidebar") : t("Collapse the sidebar"),
        keywords: "rail menu navigation hide show",
        run: () => togglePref("sidebarCollapsed"),
      },
      {
        id: "view-theme",
        group: "View",
        title: getPref("theme") === "dark" ? t("Switch to the light theme") : t("Switch to the dark theme"),
        keywords: "dark light colour color mode",
        run: () => setPref("theme", getPref("theme") === "dark" ? "light" : "dark"),
      },
    ],
    // Titles follow the prefs they toggle; the palette re-reads commands each opening.
    // openPalette is new every render and only reads what is listed here — depending on
    // it would re-register these on every render, which re-renders this, and so on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, paletteOpen, paletteQuery],
  );
  useCommands("core", athleteApp ? EMPTY : core, -1);

  /** Opens the palette, or closes it when it is already open in the same mode. */
  function openPalette(query: string) {
    if (paletteOpen) {
      if (query === paletteQuery) return closePalette();
      // Already open: switching mode means starting over in the new one.
      setPaletteOpen(false);
      requestAnimationFrame(() => {
        setPaletteQuery(query);
        setPaletteOpen(true);
      });
      return;
    }
    setSheetOpen(false);
    returnTo.current = document.activeElement as HTMLElement | null;
    setGridFocus(inGrid(document.activeElement));
    setPaletteQuery(query);
    setPaletteOpen(true);
  }

  function closePalette() {
    setPaletteOpen(false);
    // Back where the coach was typing, so a row command finds its row.
    const el = returnTo.current;
    returnTo.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (athleteApp) return;
    let timer: number | undefined;
    let fallback: Command | undefined;

    const clearChord = () => {
      window.clearTimeout(timer);
      pending = null;
      fallback = undefined;
      setWaiting(null);
    };

    function onKey(e: KeyboardEvent) {
      // A cell that handled the key keeps it; so does the key recorder.
      if (e.defaultPrevented || isRecording() || e.isComposing || isModifierKey(e)) return;
      if (e.getModifierState?.("AltGraph")) return;

      const commands = getCommands();
      const stroke = hotkey(e);
      const first = pending;
      if (!first && isEditable(document.activeElement) && !firesWhileTyping(stroke)) return;

      const byId = new Map(commands.map((c) => [c.id, c]));
      const { run, chord } = matchStroke(liveBindings(commands), stroke, first);
      clearChord();

      // An open overlay owns the keyboard, bar the key that toggles it.
      const overlay = document.querySelector("[data-overlay]");
      const allowed = (id: string) => !overlay || id === "palette" || id === "shortcuts";
      const target = run.map((id) => byId.get(id)).find((c): c is Command => Boolean(c) && allowed(c!.id));

      if (chord && !overlay) {
        e.preventDefault();
        pending = stroke;
        fallback = target;
        setWaiting(stroke);
        timer = window.setTimeout(() => {
          const late = fallback;
          clearChord();
          if (late) void late.run();
        }, CHORD_WAIT);
        return;
      }
      if (target) {
        e.preventDefault();
        void target.run();
        return;
      }
      // Second stroke of a chord that isn't bound: swallow it rather than type it.
      if (first) e.preventDefault();
      if (e.key === "Escape" && sheetOpen) setSheetOpen(false);
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearChord();
    };
  }, [athleteApp, sheetOpen]);

  if (athleteApp) return null;

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        inGrid={gridFocus}
        initialQuery={paletteQuery}
        commands={commands}
        onClose={closePalette}
        onRun={(command) => {
          closePalette();
          void command.run();
        }}
      />
      <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {waiting && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[210] -translate-x-1/2 rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-muted shadow-lg">
          {t("({keys}) was pressed. Waiting for the second key…", { keys: label(waiting) })}
        </div>
      )}
    </>
  );
}

const EMPTY: Command[] = [];
