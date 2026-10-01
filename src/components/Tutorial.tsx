"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { activeSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";

type Section = "overview" | "athletes" | "programming" | "tracking" | "competition" | "settings";

/** What the coach does in the app that a step waits for — see `tutorialDid`. */
export type TourAction = "athlete" | "program" | "exercise" | "intensity" | "rule";

/** A side of the spotlight the card can sit on. */
type Side = "right" | "left" | "below" | "above";

type Step = {
  /** The screen this step is about; the tour opens it when the step comes up. Without one, any screen. */
  page?: Section;
  /**
   * What to spotlight, as CSS selectors — the first one on screen wins. Without one, or with
   * none on screen, the card sits centred.
   */
  target?: string[];
  /** Sides of the spotlight to try for the card, in order. Beside it first by default. */
  place?: Side[];
  /** The step is done by doing it: the tour waits, and moves on by itself once it's done. */
  waitFor?: TourAction;
  title: string;
  /**
   * English text, translated when shown. Blank lines split paragraphs, lines starting
   * "- " make a list, and <b>, <i> and <k> (a key) mark text up inline.
   */
  body: string;
};

const K = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-border bg-surface px-1 py-px font-mono text-[11px] text-foreground">
    {children}
  </kbd>
);

const tour = (name: string) => `[data-tour="${name}"]`;

/** A first program, done for real, then a look round the other screens and the settings. */
const STEPS: Step[] = [
  {
    title: "Welcome to Topset",
    body: "Let's write your first program together, then take a quick look round. You do each step in the app, and the tour moves on by itself once it's done. It takes about five minutes.",
  },
  {
    target: [tour("roster")],
    waitFor: "athlete",
    title: "Add an athlete",
    body: "Click <b>+ Add athlete</b>, type a name and their 1RMs, and save.\n\nAlready have athletes? Pick one and press Skip.",
  },
  {
    page: "programming",
    target: [tour("new-program"), tour("program")],
    waitFor: "program",
    title: "Start a program",
    body: "Click <b>+ New program</b> and give it a name like “Nationals Prep”, a start date and a number of weeks. Topset lays out the training days for you.\n\nIf the athlete already has a program, <b>+ New program</b> is in the program menu here.",
  },
  {
    page: "programming",
    target: [tour("maxes")],
    title: "The 1RMs",
    body: "Loads written as a % of 1RM or an RPE are turned into kilos from these numbers. Change one and every weight in the phase follows.",
  },
  {
    page: "programming",
    target: [tour("day")],
    place: ["below", "above"],
    waitFor: "exercise",
    title: "Add an exercise",
    body: "Click the first row of a training day and type an exercise. <k>Tab</k> takes the suggestion. Everything saves as you type, there's no save button.\n\nOnly rest days? Hover one and click <b>+ TRAIN</b>.",
  },
  {
    page: "programming",
    target: [tour("intensity")],
    place: ["above", "below", "left"],
    waitFor: "intensity",
    title: "Set the load",
    body: "Fill in sets and reps, then click the intensity cell and choose how the load is written: <b>RPE</b>, <b>% of 1RM</b>, <b>kilos</b> and more.",
  },
  {
    page: "programming",
    target: [tour("progression")],
    place: ["above", "below"],
    waitFor: "rule",
    title: "Let the weeks write themselves",
    body: "Add a progression rule here, like <i>+2.5 kg per week</i>. Weeks 2, 3, 4… fill in from week 1.",
  },
  {
    page: "programming",
    target: [tour("weeks")],
    place: ["below", "above"],
    title: "Weeks",
    body: "One tab per week. Open week 2 to see your rule at work. <b>+ add week</b> copies the week before.\n\nA deload? <b>Lock week</b> and rules leave it alone.",
  },
  {
    page: "programming",
    target: [tour("exports")],
    title: "Send it out",
    body: "<b>Export</b> turns the program into a spreadsheet, a phone PDF or a printout for the athlete.",
  },
  {
    page: "overview",
    target: ["main article"],
    place: ["below", "above"],
    title: "Overview",
    body: "Every athlete at a glance: this week's sessions, how far into the program they are, and who needs a new one soon. Click a row to open it.",
  },
  {
    page: "athletes",
    target: [tour("athlete-link")],
    title: "The athlete's link",
    body: "Send an athlete their link. On their phone they see the plan, log what they lifted and answer check-ins — nothing to install.",
  },
  {
    page: "tracking",
    target: [tour("tracking-views")],
    place: ["below", "above"],
    title: "Tracking",
    body: "What was lifted against what was planned. <b>Review</b> sessions and leave notes, follow <b>Progress</b> and the 1RMs, and see <b>Wellness</b> from check-ins.",
  },
  {
    page: "competition",
    target: [tour("new-meet")],
    title: "Competition",
    body: "Add a meet and Topset plans the attempts from the 1RMs. On the day, mark each one good or missed.",
  },
  {
    page: "settings",
    target: ["#programming h2"],
    title: "Your defaults",
    body: "How many weeks a new program has, which days you train, phase names, tiers and targets. Set them once and every new program starts that way.",
  },
  {
    page: "settings",
    target: ["#view h2"],
    title: "Make it yours",
    body: "Theme, accent colour, text size, row spacing and which columns show. These stay on this computer.",
  },
  {
    page: "settings",
    target: ["#exports h2"],
    title: "Your name on it",
    body: "Your name and logo on every PDF and print, the paper size, and which export comes first.",
  },
  {
    title: "You're set",
    body: "<k>Ctrl</k>+<k>K</k> finds every action and <k>Alt</k>+<k>/</k> lists the shortcuts. This tour is under <b>Tutorial</b> at the bottom of the sidebar.",
  },
];

/** Inline <b>, <i> and <k> in a translated line, as elements. */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /<(b|i|k)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, tag, inner] = m;
    out.push(
      tag === "b" ? (
        <b key={m.index}>{inner}</b>
      ) : tag === "i" ? (
        <i key={m.index}>{inner}</i>
      ) : (
        <K key={m.index}>{inner}</K>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A step's text in the coach's language: paragraphs, lists and inline markup. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n\n").map((block, i) => {
        const lines = block.split("\n");
        const items = lines.filter((l) => l.startsWith("- "));
        const lead = lines.filter((l) => !l.startsWith("- "));
        return (
          <div key={i} className={i > 0 ? "mt-2" : ""}>
            {lead.length > 0 && <p>{inline(lead.join(" "))}</p>}
            {items.length > 0 && (
              <ul className={`list-disc space-y-0.5 pl-4 ${lead.length > 0 ? "mt-1" : ""}`}>
                {items.map((item, j) => (
                  <li key={j}>{inline(item.slice(2))}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}

const STORAGE_KEY = "topset.tutorial";

const CHANGE_EVENT = "topset:tutorial-change";

type Saved = { open: boolean; step: number };

const CLOSED = JSON.stringify({ open: false, step: 0 } satisfies Saved);

/** The tour hasn't run on this computer: it opens on its own, unless the coach said not to. */
function firstRun(): string {
  return activeSettings().showTutorial ? JSON.stringify({ open: true, step: 0 } satisfies Saved) : CLOSED;
}

function readRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? firstRun();
  } catch {
    // Storage blocked: behave as already seen rather than nag on every screen.
    return CLOSED;
  }
}

function read(): Saved {
  return JSON.parse(readRaw()) as Saved;
}

function save(state: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Opens the tour from anywhere — the sidebar button, the command palette. */
export function startTutorial() {
  save({ open: true, step: 0 });
}

/**
 * Called where the coach does something a step can wait for. Moves the tour on if that
 * step is showing, and does nothing otherwise — so callers needn't know about the tour.
 */
export function tutorialDid(action: TourAction) {
  const state = read();
  if (state.open && STEPS[state.step]?.waitFor === action) save({ open: true, step: state.step + 1 });
}

/**
 * The part of `el` on screen: a grid row runs on under the sidebar and past the edge of
 * its scroller, and the spotlight should only frame what can be seen.
 */
function visibleRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect();
  const box = el.closest("main")?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  const left = Math.max(r.left, box.left);
  const top = Math.max(r.top, box.top);
  const right = Math.min(r.right, box.right);
  const bottom = Math.min(r.bottom, box.bottom);
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

const sameRect = (a: DOMRect | null, b: DOMRect | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

const CARD_W = 340;
const GAP = 12;
const MARGIN = 12;

/**
 * Where the card goes: beside the spotlight on the first side it fits, else in the corner.
 * Level with the spotlight — or, with `hug`, with its bottom edge, so what the control
 * opens underneath stays clear while the coach works in it.
 */
function placeCard(rect: DOMRect | null, height: number, sides: Side[], hug: boolean) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = (left: number) => Math.max(MARGIN, Math.min(left, vw - CARD_W - MARGIN));
  const y = (top: number) => Math.max(MARGIN, Math.min(top, vh - height - MARGIN));
  if (!rect) return { top: y((vh - height) / 2), left: x((vw - CARD_W) / 2) };

  const level = y(hug ? rect.bottom - height : rect.top + rect.height / 2 - height / 2);
  for (const side of sides) {
    if (side === "right" && rect.right + GAP + CARD_W <= vw - MARGIN) return { top: level, left: rect.right + GAP };
    if (side === "left" && rect.left - GAP - CARD_W >= MARGIN) return { top: level, left: rect.left - GAP - CARD_W };
    if (side === "below" && rect.bottom + GAP + height <= vh - MARGIN) return { top: rect.bottom + GAP, left: x(rect.left) };
    if (side === "above" && rect.top - GAP - height >= MARGIN) return { top: rect.top - GAP - height, left: x(rect.left) };
  }
  return { top: vh - height - MARGIN, left: vw - CARD_W - MARGIN };
}

type Pos = { top: number; left: number };

/**
 * Where the card was last, kept across screens: each one mounts its own tour, and the card
 * glides on from here rather than appearing somewhere new.
 */
let lastPos: Pos | null = null;

/**
 * A first program, written for real: each step spotlights the control it's about, and the
 * ones that ask for something wait until it's done. It opens by itself the first time and
 * moves between screens as it goes. The step lives in localStorage because every screen
 * mounts its own sidebar, and this with it.
 */
export function Tutorial({ section, athleteId }: { section: Section; athleteId?: string }) {
  const router = useRouter();
  // The server has no localStorage, so it renders the tour closed and the client opens it.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const state = useMemo(() => (raw ? (JSON.parse(raw) as Saved) : null), [raw]);
  const [spot, setSpot] = useState<{ key: string; rect: DOMRect | null } | null>(null);

  const step = state?.open ? STEPS[state.step] : undefined;
  const onPage = !step?.page || step.page === section;
  const spotKey = `${state?.step}:${section}`;
  const rect = spot?.key === spotKey ? spot.rect : null;
  /** The step during which the coach last moved focus out into the app, if they did. */
  const [workingOn, setWorkingOn] = useState<number | null>(null);

  // While the coach works somewhere else — a form, a grid cell — the card shrinks to its
  // title, so it never sits on top of what they're filling in. A step that has just come up
  // shows in full until they move on, and clicking the card brings it back.
  useEffect(() => {
    const update = () => {
      const el = document.activeElement;
      // Any control, not just fields: a form's own buttons take the focus as they're
      // pressed, and the card growing back under the pointer would catch the click.
      const away = el instanceof HTMLElement && el !== document.body && !el.closest("[data-tutorial-card]");
      setWorkingOn(away ? read().step : null);
    };
    // Focus has left but not yet landed while focusout runs.
    const later = () => setTimeout(update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
    };
  }, []);

  // Follow the spotlit control. It can turn up late (a screen still loading, a row just
  // typed) and move as the coach works, so it is looked for again every so often.
  useLayoutEffect(() => {
    if (!step?.target || !onPage) return;

    let scrolled = false;
    const tick = () => {
      const el = step.target!.map((selector) => document.querySelector<HTMLElement>(selector)).find(Boolean);
      if (el && !scrolled) {
        el.scrollIntoView({ block: el.offsetHeight > window.innerHeight / 2 ? "start" : "center", inline: "nearest" });
        scrolled = true;
      }
      const next = el ? visibleRect(el) : null;
      setSpot((prev) => (prev?.key === spotKey && sameRect(prev.rect, next) ? prev : { key: spotKey, rect: next }));
    };
    tick();

    const timer = setInterval(tick, 250);
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", tick, true);
    };
  }, [step, onPage, spotKey]);

  const compact = !!step?.waitFor && onPage && workingOn === state?.step;

  const [cardHeight, setCardHeight] = useState(200);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(() => setCardHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // While the spotlight is still being looked for, the card stays put rather than drifting
  // to the middle and back.
  const looking = !!step?.target && onPage && spot?.key !== spotKey;
  const goal =
    step && !looking ? placeCard(rect, cardHeight, step.place ?? ["right", "left", "below", "above"], compact) : null;
  const [pos, setPos] = useState<Pos | null>(() => lastPos);
  // Moved a frame later, so a card that has just mounted starts where the last one was.
  useEffect(() => {
    if (!goal || (pos && pos.top === goal.top && pos.left === goal.left)) return;
    const frame = requestAnimationFrame(() => {
      lastPos = goal;
      setPos(goal);
    });
    return () => cancelAnimationFrame(frame);
  });

  if (!state || !step) return null;

  const go = (index: number) => {
    const next = STEPS[index];
    save({ open: true, step: index });
    if (next.page && next.page !== section) {
      router.push(`/${next.page}${athleteId ? `?athlete=${athleteId}` : ""}`);
    }
  };
  const close = () => save({ ...state, open: false });

  const last = state.step === STEPS.length - 1;
  const first = state.step === 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-[200]">
      {/* A step that waits for the coach leaves the screen undimmed: the dialogs and menus
          it opens sit outside the spotlight. */}
      {rect ? (
        <div
          className="absolute rounded-lg ring-2 ring-accent transition-all duration-200"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: step.waitFor ? undefined : "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : (
        !step.waitFor && <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        ref={measure}
        data-tutorial-card
        tabIndex={-1}
        role="dialog"
        aria-label={t(step.title)}
        style={{ ...(pos ?? goal ?? placeCard(null, cardHeight, [], false)), width: CARD_W }}
        className="pointer-events-auto absolute rounded-xl border border-border bg-surface-2 p-4 shadow-2xl shadow-black/60 outline-none duration-300 ease-out motion-safe:transition-[top,left]"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] tracking-[0.14em] text-muted-2">
            TUTORIAL · {state.step + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={close}
            title={t("Close the tutorial")}
            className="rounded px-1 text-[14px] leading-none text-muted-2 hover:text-foreground"
          >
            ×
          </button>
        </div>

        <h2 className="mt-1.5 text-[15px] font-semibold">{t(step.title)}</h2>
        {!compact && (
          <>
            <div className="mt-1.5 text-[12px] leading-relaxed text-muted">
              <Rich text={t(step.body)} />
            </div>

            {!onPage && step.page && (
              <button
                type="button"
                onClick={() => go(state.step)}
                className="mt-2 text-[11px] text-accent hover:underline"
              >
                {t("Go to {page} →", {
                  page: t(step.page[0].toUpperCase() + step.page.slice(1)),
                })}
              </button>
            )}

            {first ? (
              <div className="mt-4 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => go(1)}
                  className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white"
                >
                  {t("Start")}
                </button>
                <button type="button" onClick={close} className="text-[11px] text-muted-2 hover:text-foreground">
                  {t("Skip the tutorial")}
                </button>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => go(state.step - 1)}
                  className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground"
                >
                  {t("Back")}
                </button>
                {step.waitFor && onPage && (
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-2">
                    <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                    {t("Your turn")}
                  </span>
                )}
                {last ? (
                  <button
                    type="button"
                    onClick={close}
                    className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
                  >
                    {t("Finish")}
                  </button>
                ) : step.waitFor ? (
                  <button
                    type="button"
                    onClick={() => go(state.step + 1)}
                    className={`${onPage ? "" : "ml-auto"} rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground`}
                  >
                    {t("Skip")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => go(state.step + 1)}
                    className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
                  >
                    {t("Next")}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
